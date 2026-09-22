// SwiftCipher Classroom agent (MV3 service worker).
//
// Privacy boundary: the server only returns state "active" while this device's
// student is in a LIVE class session. In any other state the agent sends a
// bare heartbeat (no URL, no title, no screenshot) and does nothing else.

const VERSION = chrome.runtime.getManifest().version;
const ALARM = "sc-heartbeat";
const THUMB_WIDTH = 480;
const SPOTLIGHT_WIDTH = 1280;

// ---------------------------------------------------------------------------
// Config & state
// ---------------------------------------------------------------------------
async function config() {
  const managed = await chrome.storage.managed.get(["serverUrl", "deviceLabel"]).catch(() => ({}));
  const local = await chrome.storage.local.get(["serverUrl", "deviceId", "secret", "state", "policy", "focus", "lock", "lastCaptureAt", "lastError"]);
  return { ...local, serverUrl: (managed.serverUrl || local.serverUrl || "").replace(/\/+$/, ""), deviceLabel: managed.deviceLabel, managedServer: !!managed.serverUrl };
}

async function api(path, body) {
  const cfg = await config();
  if (!cfg.serverUrl) throw new Error("Server URL is not configured.");
  const res = await fetch(`${cfg.serverUrl}/api/devices/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------
async function enroll(code, serverUrl) {
  if (serverUrl) await chrome.storage.local.set({ serverUrl: serverUrl.replace(/\/+$/, "") });
  const cfg = await config();
  const info = await chrome.runtime.getPlatformInfo();
  const r = await api("enroll", {
    code: String(code).trim().toUpperCase(),
    label: cfg.deviceLabel || `${info.os} browser`,
    os: info.os,
    browser: navigator.userAgent.includes("Edg/") ? "Edge" : "Chrome",
    version: VERSION
  });
  await chrome.storage.local.set({ deviceId: r.device_id, secret: r.secret, studentName: r.student_name, notice: r.notice, state: "idle", lastError: null });
  scheduleAlarm(1);
  tick("heartbeat");
  return r;
}

async function unpair() {
  await chrome.storage.local.remove(["deviceId", "secret", "studentName", "notice", "state", "policy", "focus", "lock"]);
  await chrome.alarms.clear(ALARM);
}

// ---------------------------------------------------------------------------
// Heartbeat / telemetry
// ---------------------------------------------------------------------------
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

let ticking = false;
async function tick(kind = "heartbeat") {
  if (ticking) return;
  ticking = true;
  try {
    const cfg = await config();
    if (!cfg.deviceId || !cfg.secret || !cfg.serverUrl) return;
    const active = cfg.state === "active";
    const tab = active ? await activeTab() : null;
    const tabs = active ? await chrome.tabs.query({}) : [];
    const idle = await chrome.idle.queryState(60);
    const payload = {
      device_id: cfg.deviceId, secret: cfg.secret, version: VERSION, idle_state: idle,
      // Outside a live session nothing about browsing is sent.
      url: active ? tab?.url ?? null : null,
      title: active ? tab?.title ?? null : null,
      tab_count: active ? tabs.length : null
    };
    const r = kind === "heartbeat" ? await api("heartbeat", payload) : await api("events", { ...payload, kind });
    await applyDirectives(r, cfg);
    await chrome.storage.local.set({ lastOkAt: Date.now(), lastError: null });
  } catch (e) {
    await chrome.storage.local.set({ lastError: String(e.message || e) });
    if (e.status === 401) {
      // Disabled or unenrolled remotely (§21 remote disable/unenrol).
      await chrome.storage.local.set({ state: "disabled", policy: null, focus: null, lock: false });
    }
  } finally {
    ticking = false;
  }
}

function scheduleAlarm(minutes) {
  // MV3 alarms have a 30-second minimum; event listeners cover faster changes.
  chrome.alarms.create(ALARM, { periodInMinutes: Math.max(0.5, minutes) });
}

async function applyDirectives(r, cfg) {
  const wasActive = cfg.state === "active";
  await chrome.storage.local.set({ state: r.state, session: r.session ?? null, policy: r.policy ?? null, verdict: r.verdict ?? null, notice: r.notice ?? cfg.notice });
  scheduleAlarm(r.state === "active" ? 0.5 : (r.poll_seconds ?? 60) / 60);

  if (r.state !== "active") {
    if (wasActive) await chrome.storage.local.set({ focus: null, lock: false });
    return;
  }
  // Just became active: send real telemetry immediately.
  if (!wasActive) setTimeout(() => tick("tab_changed"), 250);

  for (const cmd of r.commands ?? []) await runCommand(cmd, cfg);

  if (r.notice && r.verdict === "violation") notify("sc-notice", "Back to class", r.notice);
  await enforce(await activeTab());

  if (r.capture?.enabled) {
    const now = Date.now();
    const due = now - (cfg.lastCaptureAt || 0) >= (r.capture.interval_seconds || 20) * 1000;
    if (r.capture.high_quality) await capture("spotlight", cfg);
    else if (due) await capture("thumbnail", cfg);
  }
}

// ---------------------------------------------------------------------------
// Screen capture (§15): low-res thumbnails, higher quality only for spotlight.
// ---------------------------------------------------------------------------
async function capture(quality, cfg) {
  try {
    const tab = await activeTab();
    if (!tab || !/^https?:/.test(tab.url || "")) return; // never capture browser-internal pages
    const raw = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
    const blob = await (await fetch(raw)).blob();
    const bmp = await createImageBitmap(blob);
    const width = quality === "spotlight" ? SPOTLIGHT_WIDTH : THUMB_WIDTH;
    const scale = Math.min(1, width / bmp.width);
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: quality === "spotlight" ? 0.7 : 0.45 });
    const image = await blobToDataUrl(out);
    await api("snapshot", { device_id: cfg.deviceId, secret: cfg.secret, image, width: canvas.width, height: canvas.height, quality, url: tab.url });
    await chrome.storage.local.set({ lastCaptureAt: Date.now() });
  } catch (e) {
    // Capture can fail on protected pages; the teacher sees "unavailable", never a stale frame.
  }
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(bin)}`;
}

// ---------------------------------------------------------------------------
// Teacher commands (§3.5) with acknowledgement (§21)
// ---------------------------------------------------------------------------
function safeUrl(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; }
}

async function runCommand(cmd, cfg) {
  let ok = true, error = null;
  try {
    const url = safeUrl(cmd.payload?.url);
    const tab = await activeTab();
    switch (cmd.kind) {
      case "open_tab": if (!url) throw new Error("invalid url"); await chrome.tabs.create({ url, active: true }); break;
      case "redirect": if (!url) throw new Error("invalid url"); if (tab) await chrome.tabs.update(tab.id, { url }); else await chrome.tabs.create({ url }); break;
      case "close_tab": if (tab && /^https?:/.test(tab.url || "")) await chrome.tabs.remove(tab.id); break;
      case "close_other_tabs": {
        const all = await chrome.tabs.query({ currentWindow: true });
        await chrome.tabs.remove(all.filter((t) => t.id !== tab?.id && !t.pinned).map((t) => t.id));
        break;
      }
      case "focus":
        await chrome.storage.local.set({ focus: url ?? cfg.policy?.lesson_url ?? null });
        if (url) { if (tab) await chrome.tabs.update(tab.id, { url }); else await chrome.tabs.create({ url }); }
        break;
      case "unfocus": await chrome.storage.local.set({ focus: null }); break;
      case "lock": await chrome.storage.local.set({ lock: true }); await enforce(tab); break;
      case "unlock": {
        await chrome.storage.local.set({ lock: false });
        if (tab?.url?.startsWith(chrome.runtime.getURL("blocked.html"))) await chrome.tabs.goBack(tab.id).catch(() => {});
        break;
      }
      case "message": notify(`sc-msg-${cmd.id}`, "Message from your teacher", String(cmd.payload?.text || "").slice(0, 200)); break;
      case "screenshot": await capture("spotlight", cfg); break;
      default: throw new Error(`unsupported command ${cmd.kind}`);
    }
  } catch (e) {
    ok = false;
    error = String(e.message || e);
  }
  await api("commands/ack", { device_id: cfg.deviceId, secret: cfg.secret, command_id: cmd.id, ok, error }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Client-side enforcement while a session is active (focus / lock / blocklist).
// The server still evaluates and records everything; this only keeps the
// student on track and fails open if the policy can't be read.
// ---------------------------------------------------------------------------
function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}
function matches(h, pattern) {
  const p = String(pattern || "").toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^(\*\.|www\.)/, "").replace(/[/:?#].*$/, "");
  return !!h && !!p && (h === p || h.endsWith("." + p));
}

async function enforce(tab) {
  const cfg = await config();
  if (cfg.state !== "active" || !tab?.id || !tab.url || !/^https?:/.test(tab.url)) return;
  const h = host(tab.url);
  const server = host(cfg.serverUrl);
  if (h && server && matches(h, server)) return; // the SwiftCipher app is always allowed
  const p = cfg.policy || {};
  const allowed = [...(p.allowed_domains || []), ...(p.required_urls || []), p.lesson_url].filter(Boolean);
  const blockedPage = (reason) => chrome.runtime.getURL(`blocked.html?reason=${encodeURIComponent(reason)}&back=${encodeURIComponent(cfg.focus || p.lesson_url || "")}`);

  if (cfg.lock) {
    await chrome.tabs.update(tab.id, { url: blockedPage("Your teacher has paused screens. Please look up.") });
  } else if (cfg.focus && !matches(h, host(cfg.focus))) {
    await chrome.tabs.update(tab.id, { url: cfg.focus });
  } else if ((p.blocked_domains || []).some((d) => matches(h, d))) {
    await chrome.tabs.update(tab.id, { url: blockedPage("This site is blocked during your class session.") });
  } else if (p.lock_screen && allowed.length && !allowed.some((d) => matches(h, host(d) || d))) {
    await chrome.tabs.update(tab.id, { url: blockedPage("Your class session requires you to return to the lesson.") });
  }
}

function notify(id, title, message) {
  chrome.notifications.create(id, { type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 2 }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) tick("heartbeat"); });
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(0.5); tick("heartbeat"); });
chrome.runtime.onInstalled.addListener(() => { scheduleAlarm(0.5); tick("heartbeat"); });

let debounce;
function onTabChange(kind) {
  clearTimeout(debounce);
  debounce = setTimeout(async () => {
    const cfg = await config();
    if (cfg.state === "active") { await enforce(await activeTab()); tick(kind); }
  }, 400);
}
chrome.tabs.onActivated.addListener(() => onTabChange("tab_changed"));
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.url || info.status === "complete") onTabChange("navigation"); });
chrome.tabs.onRemoved.addListener(() => onTabChange("tab_count"));
chrome.windows.onFocusChanged.addListener(() => onTabChange("tab_changed"));
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener((s) => tick(s === "active" ? "active" : s));

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    try {
      if (msg.type === "enroll") send({ ok: true, result: await enroll(msg.code, msg.serverUrl) });
      else if (msg.type === "unpair") { await unpair(); send({ ok: true }); }
      else if (msg.type === "status") {
        const cfg = await config();
        let remote = null;
        if (cfg.deviceId && cfg.secret) remote = await api("status", { device_id: cfg.deviceId, secret: cfg.secret }).catch((e) => ({ error: e.message }));
        send({ ok: true, cfg: { serverUrl: cfg.serverUrl, managedServer: cfg.managedServer, paired: !!cfg.deviceId, state: cfg.state, lastError: cfg.lastError }, remote });
      } else if (msg.type === "tick") { await tick("heartbeat"); send({ ok: true }); }
    } catch (e) {
      send({ ok: false, error: String(e.message || e) });
    }
  })();
  return true;
});
