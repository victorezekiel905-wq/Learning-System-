const params = new URLSearchParams(location.search);
const reason = params.get("reason");
if (reason) document.getElementById("reason").textContent = reason.slice(0, 200);
const back = params.get("back");
try {
  const u = new URL(back);
  if (/^https?:$/.test(u.protocol)) {
    const a = document.getElementById("back");
    a.href = u.toString();
    a.hidden = false;
  }
} catch { /* no return link */ }
