// Supabase REST helper for the extension. Uses the project's public anon key
// (publishable by design). All agent operations go through security-definer
// RPCs from supabase/migrations/20260101000400_agent_rpc.sql and
// 20260101000600_more_rpc.sql.
async function rpc(name, params) {
  const cfg = await chrome.storage.local.get(["SUPABASE_URL", "SUPABASE_ANON"]);
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON) {
    throw new Error("Not configured — open the extension popup and add SUPABASE_URL + SUPABASE_ANON");
  }
  const url = cfg.SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: cfg.SUPABASE_ANON,
      Authorization: `Bearer ${cfg.SUPABASE_ANON}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params || {})
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${name} → ${res.status} ${t.slice(0, 120)}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : null;
}

async function lookupSession(joinCode) {
  const rows = await rpc("session_by_code", { p_code: String(joinCode).toUpperCase().trim() });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function heartbeat(deviceUid) {
  return rpc("device_heartbeat", { p_device_uid: deviceUid });
}

async function postEvent(deviceUid, kind, url, sessionId, title) {
  return rpc("device_post_event", {
    p_device_uid: deviceUid, p_kind: kind, p_url: url || null,
    p_session: sessionId || null, p_title: title || null
  });
}

async function postSnapshot(deviceUid, sessionId, dataUrl, url, title) {
  return rpc("device_post_snapshot", {
    p_device_uid: deviceUid, p_session: sessionId, p_data_url: dataUrl,
    p_url: url || null, p_title: title || null
  });
}

async function pollCommands(deviceUid) {
  const rows = await rpc("device_poll_commands_by_device", { p_device_uid: deviceUid });
  return Array.isArray(rows) ? rows : [];
}

async function ackCommand(cmdId) {
  return rpc("device_ack_command", { p_id: cmdId });
}

globalThis.__agentApi = { rpc, lookupSession, heartbeat, postEvent, postSnapshot, pollCommands, ackCommand };
