import { deviceCall, preflight, str } from "@/lib/device-gateway";

export const OPTIONS = preflight;

/** POST {code, label, os, browser, version} → {device_id, secret, student_name, notice} */
export function POST(req: Request) {
  return deviceCall(req, {
    fn: "device_pair", perMinute: 10, requireDevice: false,
    map: (b) => ({ p_code: str(b.code, 12), p_label: str(b.label, 120) ?? "Browser", p_os: str(b.os, 60), p_browser: str(b.browser, 60), p_version: str(b.version, 20) })
  });
}
