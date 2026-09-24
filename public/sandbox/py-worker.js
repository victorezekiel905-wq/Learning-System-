// Runs student Python with Pyodide. Served with its own Content-Security-Policy
// (next.config.mjs, /sandbox/*): the only network access allowed is the pinned
// Pyodide CDN, never the SwiftCipher API. Terminated by the page on timeout.
"use strict";
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";
const MAX_OUTPUT = 20000;
importScripts(PYODIDE + "pyodide.js");
let ready = null;

self.onmessage = async (e) => {
  let out = "";
  try {
    ready = ready || loadPyodide({ indexURL: PYODIDE });
    const py = await ready;
    py.setStdout({ batched: (s) => { out += s + "\n"; } });
    py.setStderr({ batched: (s) => { out += s + "\n"; } });
    await py.runPythonAsync(String(e.data || ""));
    self.postMessage({ stdout: out.slice(0, MAX_OUTPUT), error: null });
  } catch (err) {
    self.postMessage({ stdout: out.slice(0, MAX_OUTPUT), error: String(err) });
  }
};
