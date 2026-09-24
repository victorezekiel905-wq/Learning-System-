// Runs student JavaScript. Served with its own Content-Security-Policy
// (next.config.mjs, /sandbox/*): no network access at all, so student code
// can't call the SwiftCipher API with the viewer's session. The page that
// starts this worker terminates it on timeout, so infinite loops can't hang
// the tab.
"use strict";
const MAX_OUTPUT = 20000;

self.onmessage = (e) => {
  const { source, tests } = e.data || {};
  const out = [];
  const fmt = (x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })());
  const log = (...a) => { out.push(a.map(fmt).join(" ")); };
  self.console = { log, error: log, warn: log, info: log, debug: log };
  const results = [];
  let error = null;
  try {
    new Function(String(source || ""))();
    for (const t of Array.isArray(tests) ? tests : []) {
      try {
        const got = String(new Function("return (" + (t.input || "undefined") + ")")());
        results.push({ name: String(t.name), passed: got === String(t.expected), got });
      } catch (err) {
        results.push({ name: String(t.name), passed: false, got: String(err) });
      }
    }
  } catch (err) {
    error = String((err && err.stack) || err);
  }
  self.postMessage({ stdout: out.join("\n").slice(0, MAX_OUTPUT), error, tests: results });
};
