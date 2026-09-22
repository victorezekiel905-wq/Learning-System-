import { deviceCall, preflight, str } from "@/lib/device-gateway";

export const OPTIONS = preflight;

/** POST {device_id, secret} → who the device belongs to, school notice, live session (for the popup). */
export function POST(req: Request) {
  return deviceCall(req, {
    fn: "device_status", perMinute: 30,
    map: (b) => ({ p_device: b.device_id, p_secret: str(b.secret, 128) })
  });
}
