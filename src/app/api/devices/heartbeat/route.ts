import { appHost, deviceCall, int, preflight, str } from "@/lib/device-gateway";

export const OPTIONS = preflight;

/** POST {device_id, secret, url, title, tab_count, idle_state, version} → directives for the agent. */
export function POST(req: Request) {
  return deviceCall(req, {
    fn: "device_heartbeat", perMinute: 60,
    map: (b) => ({
      p_device: b.device_id, p_secret: str(b.secret, 128), p_url: str(b.url), p_title: str(b.title, 300),
      p_tab_count: int(b.tab_count), p_idle_state: str(b.idle_state, 10) ?? "active", p_version: str(b.version, 20), p_app_host: appHost()
    })
  });
}
