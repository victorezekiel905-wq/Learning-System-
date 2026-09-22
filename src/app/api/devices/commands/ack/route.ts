import { deviceCall, preflight, str } from "@/lib/device-gateway";

export const OPTIONS = preflight;

/** POST {device_id, secret, command_id, ok, error} — command acknowledgement (§21). */
export function POST(req: Request) {
  return deviceCall(req, {
    fn: "device_command_ack", perMinute: 120,
    map: (b) => ({ p_device: b.device_id, p_secret: str(b.secret, 128), p_command: b.command_id, p_ok: b.ok === true, p_error: str(b.error, 300) })
  });
}
