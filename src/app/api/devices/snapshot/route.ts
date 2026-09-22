import { deviceCall, int, preflight, str } from "@/lib/device-gateway";

export const OPTIONS = preflight;

/** POST {device_id, secret, image (data:image/jpeg;base64…), width, height, quality, url} */
export function POST(req: Request) {
  return deviceCall(req, {
    fn: "device_snapshot", perMinute: 40, maxBytes: 450_000,
    map: (b) => ({
      p_device: b.device_id, p_secret: str(b.secret, 128), p_image: str(b.image, 400_000), p_width: int(b.width), p_height: int(b.height),
      p_quality: b.quality === "spotlight" ? "spotlight" : "thumbnail", p_url: str(b.url)
    })
  });
}
