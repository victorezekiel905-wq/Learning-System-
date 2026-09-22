// Extension popup controller — configuration + pairing UI.
const $ = (id) => document.getElementById(id);
const status = $("status");

function say(text, ok) {
  status.textContent = text;
  status.className = ok ? "ok" : "";
}

chrome.storage.local.get(["SUPABASE_URL", "SUPABASE_ANON", "DEVICE_UID", "SESSION_ID"]).then((cfg) => {
  $("url").value = cfg.SUPABASE_URL || "";
  $("anon").value = cfg.SUPABASE_ANON || "";
  $("uid").value = cfg.DEVICE_UID || "";
});

$("save").addEventListener("click", () => {
  const url = $("url").value.trim().replace(/\/$/, "");
  const anon = $("anon").value.trim();
  const uid = $("uid").value.trim();
  if (!url || !anon || !uid) { say("URL, anon key and device UID are required", false); return; }
  chrome.storage.local.set({ SUPABASE_URL: url, SUPABASE_ANON: anon, DEVICE_UID: uid }).then(() => {
    say("Configuration saved. Agent alarms are active.", true);
  });
});

$("lookup").addEventListener("click", async () => {
  const code = $("code").value.trim().toUpperCase();
  if (!code) { say("Enter the session join code first", false); return; }
  try {
    const session = await globalThis.__agentApi.lookupSession(code);
    if (!session) { say("No live session found for that code", false); return; }
    await chrome.storage.local.set({ SESSION_ID: session.id });
    say(`Paired to session ${code} (${session.state}). Thumbnails will be sent every 30s.`, true);
  } catch (e) {
    say(e.message, false);
  }
});

$("test").addEventListener("click", async () => {
  try {
    const cfg = await chrome.storage.local.get(["DEVICE_UID"]);
    await globalThis.__agentApi.heartbeat(cfg.DEVICE_UID);
    say("Heartbeat OK.", true);
  } catch (e) {
    say(e.message, false);
  }
});

// Load the agent API (importScripts is service-worker only, so inject the same module).
chrome.runtime.getBackgroundPage ? (() => {})() : null;
fetch(chrome.runtime.getURL("api.js")).then((r) => r.text()).then((code) => {
  const fn = new Function(`${code}; return globalThis.__agentApi;`);
  globalThis.__agentApi = fn();
}).catch(() => {});
