// EduClass Fusion Classroom Agent — service worker
importScripts("api.js");
const api = globalThis.__agentApi;

const HEARTBEAT_MS = 20_000;
const POLL_MS = 6_000;
const SNAP_MS = 30_000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("hb", { periodInMinutes: HEARTBEAT_MS / 60000 });
  chrome.alarms.create("poll", { periodInMinutes: POLL_MS / 60000 });
  chrome.alarms.create("snap", { periodInMinutes: SNAP_MS / 60000 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const cfg = await chrome.storage.local.get(["DEVICE_UID"]);
  if (!cfg.DEVICE_UID) return;
  try {
    if (alarm.name === "hb") await api.heartbeat(cfg.DEVICE_UID);
    if (alarm.name === "poll") await pollAndDispatch();
    if (alarm.name === "snap") await captureAndPost();
  } catch (e) {
    console.warn("[EduClass Fusion agent]", e.message);
  }
});

// Report active tab changes in real time.
chrome.tabs.onActivated.addListener(() => reportActiveTab());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.status === "complete") reportActiveTab();
});

async function reportActiveTab() {
  const cfg = await chrome.storage.local.get(["DEVICE_UID", "SESSION_ID"]);
  if (!cfg.DEVICE_UID) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) return;
  try {
    await api.postEvent(cfg.DEVICE_UID, "tab_changed", tab.url, cfg.SESSION_ID || null, tab.title || null);
  } catch (e) { /* telemetry is best-effort */ }
}

async function pollAndDispatch() {
  const cfg = await chrome.storage.local.get(["DEVICE_UID"]);
  const cmds = await api.pollCommands(cfg.DEVICE_UID);
  for (const cmd of cmds) {
    await execute(cmd);
    await api.ackCommand(cmd.id);
  }
}

async function execute(cmd) {
  const payload = cmd.payload || {};
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  try {
    switch (cmd.kind) {
      case "open_tab":
        if (payload.url) await chrome.tabs.create({ url: payload.url });
        break;
      case "close_tab":
        if (tab && tab.id != null) await chrome.tabs.remove(tab.id);
        break;
      case "redirect":
        if (tab && tab.id != null && payload.url) await chrome.tabs.update(tab.id, { url: payload.url });
        break;
      case "focus":
      case "lock":
        await chrome.tabs.sendMessage(tab && tab.id != null ? tab.id : 0, { cmd: cmd.kind, payload })
          .catch(() => {});
        break;
    }
  } catch (e) {
    console.warn("[agent] command", cmd.kind, "failed:", e.message);
  }
}

async function captureAndPost() {
  const cfg = await chrome.storage.local.get(["DEVICE_UID", "SESSION_ID"]);
  if (!cfg.DEVICE_UID || !cfg.SESSION_ID) return; // only when paired to a live session
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.id) return;
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 35 }).catch(() => null);
  if (!dataUrl) return; // tab cannot be captured (e.g. chrome:// pages) — skip, never fake it
  const small = await downscale(dataUrl, 160);
  await api.postSnapshot(cfg.DEVICE_UID, cfg.SESSION_ID, small, tab.url || null, tab.title || null);
}

async function downscale(dataUrl, width) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const ratio = bmp.width ? width / bmp.width : 1;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * ratio)), Math.max(1, Math.round(bmp.height * ratio)));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.4 });
  return await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.readAsDataURL(out);
  });
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "AGENT_STATUS") {
    chrome.storage.local.get(["DEVICE_UID", "SESSION_ID", "SUPABASE_URL"]).then((cfg) => {
      sendResponse({ configured: !!(cfg.DEVICE_UID && cfg.SUPABASE_URL), deviceUid: cfg.DEVICE_UID || null, sessionId: cfg.SESSION_ID || null });
    });
    return true;
  }
  if (msg.type === "AGENT_PAIR") {
    chrome.storage.local.set({ DEVICE_UID: msg.deviceUid, SESSION_ID: msg.sessionId || null }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }
});
