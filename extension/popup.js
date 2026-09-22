const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

async function render() {
  $("err").textContent = "";
  const r = await send({ type: "status" });
  if (!r?.ok) { $("err").textContent = r?.error || "Extension error"; return; }
  const { cfg, remote } = r;
  $("setup").hidden = cfg.paired;
  $("paired").hidden = !cfg.paired;
  $("serverRow").hidden = cfg.managedServer;
  $("server").value = cfg.serverUrl || "";
  if (!cfg.paired) return;

  if (remote?.error) {
    $("state").className = "pill off";
    $("state").textContent = /disabled|unenrolled|credentials/i.test(remote.error) ? "Disabled by school" : "Can't reach server";
    $("err").textContent = remote.error;
    return;
  }
  $("student").textContent = remote?.student_name || "Unassigned device";
  $("school").textContent = remote?.school || "";
  $("notice").textContent = remote?.notice || "";
  const live = !!remote?.session;
  $("state").className = `pill ${live ? "live" : "idle"}`;
  $("state").textContent = live ? "Live class: sharing with teacher" : "No live class: nothing shared";
  $("session").textContent = live ? `Session: ${remote.session.title}` : "";
  $("details").href = `${cfg.serverUrl}/student/device`;
  if (cfg.lastError) $("err").textContent = `Last problem: ${cfg.lastError}`;
}

$("pair").addEventListener("click", async () => {
  $("pair").disabled = true;
  const r = await send({ type: "enroll", code: $("code").value, serverUrl: $("server").value.trim() || undefined });
  $("pair").disabled = false;
  if (!r?.ok) { $("err").textContent = r?.error || "Pairing failed"; return; }
  render();
});
$("refresh").addEventListener("click", async () => { await send({ type: "tick" }); render(); });
$("unpair").addEventListener("click", async () => {
  if (!confirm("Remove SwiftCipher from this browser? Your school may need to pair it again.")) return;
  await send({ type: "unpair" });
  render();
});

render();
