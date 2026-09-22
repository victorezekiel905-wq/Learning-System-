// Content script: renders focus/lock overlays when the teacher commands them.
(() => {
  let overlay = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && (msg.cmd === "focus" || msg.cmd === "lock")) {
      showOverlay(msg.cmd, msg.payload || {});
    } else if (msg && msg.cmd === "clear") {
      hideOverlay();
    }
  });

  function showOverlay(kind, payload) {
    hideOverlay();
    overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:2147483647",
      "background:#0f172a", "color:#fff",
      "display:flex", "flex-direction:column", "align-items:center", "justify-content:center",
      "gap:12px", "font-family:system-ui,sans-serif", "text-align:center", "padding:24px"
    ].join(";");
    const icon = document.createElement("div");
    icon.textContent = kind === "lock" ? "🔒" : "🎯";
    icon.style.fontSize = "56px";
    const title = document.createElement("div");
    title.style.fontSize = "22px";
    title.style.fontWeight = "600";
    title.textContent = kind === "lock" ? "This screen is locked by your teacher" : "Focus time — stay on the lesson";
    const body = document.createElement("div");
    body.style.fontSize = "14px";
    body.style.opacity = "0.8";
    body.textContent = payload.message || "Return to the lesson materials. Class is in session.";
    overlay.append(icon, title, body);
    document.documentElement.appendChild(overlay);
  }

  function hideOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
  }
})();
