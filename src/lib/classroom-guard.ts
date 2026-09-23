"use client";
// Student side of the web classroom (no extension needed):
//  • shares the student's entire screen (the browser always asks the student),
//    sends small frames to the teacher's screen strip and a sharper one while
//    the teacher has that student open;
//  • reports whether the lesson is in front of the student (tab/app switch,
//    minimise, full screen, share stopped). Under lockdown the server turns a
//    long enough absence into a "left the class" alert for the teacher.
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "@/lib/rpc";

export type GuardDirectives = {
  status: string;
  lockdown: boolean;
  away: boolean;
  reason: string | null;
  capture: { enabled: boolean; interval_seconds: number; high_quality: boolean };
};

type FrameGrabber = { grabFrame(): Promise<ImageBitmap> };
// Chrome/Edge only (it keeps working while the lesson tab is in the background);
// elsewhere we fall back to drawing a <video> element.
const FrameCapture = () =>
  (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => FrameGrabber }).ImageCapture;

const MAX_BYTES = 380_000;

function lessonInFront() {
  if (typeof document === "undefined") return true;
  if (document.hidden) return false;
  // Clicking into an embedded video/iframe moves focus there; that's still the lesson.
  return document.hasFocus() || document.activeElement?.tagName === "IFRAME";
}
const isFullscreen = () => typeof document !== "undefined" && !!document.fullscreenElement;

export function canShareScreen() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}
export function canFullscreen() {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
}

export function useClassroomGuard(sessionId: string, opts: { live: boolean; managedDevice: boolean }) {
  const [sharing, setSharing] = useState(false);
  const [surface, setSurface] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [directives, setDirectives] = useState<GuardDirectives | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [supported] = useState(() => ({ share: canShareScreen(), fullscreen: canFullscreen() }));

  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const grabber = useRef<FrameGrabber | null>(null);
  const lastThumb = useRef(0);
  const directivesRef = useRef<GuardDirectives | null>(null);
  directivesRef.current = directives;

  // Phones/tablets can't share a screen or go full screen from a web page:
  // they're only held to "keep the lesson open and in front".
  const unsupported = !supported.share || !supported.fullscreen;

  const report = useCallback(async (override?: Partial<{ visible: boolean; fullscreen: boolean; sharing: boolean }>) => {
    if (!opts.live) return;
    try {
      const d = await rpc<GuardDirectives>("student_report", {
        p_session: sessionId,
        p_visible: override?.visible ?? lessonInFront(),
        p_fullscreen: override?.fullscreen ?? isFullscreen(),
        p_sharing: (override?.sharing ?? !!stream.current?.active) || opts.managedDevice,
        p_surface: surface,
        p_unsupported: unsupported
      });
      setDirectives(d);
    } catch { /* offline: the next tick retries */ }
  }, [sessionId, opts.live, opts.managedDevice, surface, unsupported]);

  const capture = useCallback(async (quality: "thumbnail" | "spotlight") => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return;
    const width = quality === "spotlight" ? 1280 : 480;
    try {
      let source: CanvasImageSource | null = null, sw = 0, sh = 0;
      if (grabber.current) {
        const bmp = await grabber.current.grabFrame();
        source = bmp; sw = bmp.width; sh = bmp.height;
      } else if (video.current && video.current.videoWidth) {
        source = video.current; sw = video.current.videoWidth; sh = video.current.videoHeight;
      }
      if (!source || !sw) return;
      const scale = Math.min(1, width / sw);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
      canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
      if ("close" in source && typeof source.close === "function") source.close();
      let q = 0.6, img = canvas.toDataURL("image/jpeg", q);
      while (img.length > MAX_BYTES && q > 0.2) { q -= 0.15; img = canvas.toDataURL("image/jpeg", q); }
      if (img.length > MAX_BYTES) return;
      await rpc("student_screen_frame", { p_session: sessionId, p_image: img, p_width: canvas.width, p_height: canvas.height, p_quality: quality });
    } catch { /* a missed frame is fine */ }
  }, [sessionId]);

  const stopShare = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null; grabber.current = null;
    if (video.current) video.current.srcObject = null;
    setSharing(false);
  }, []);

  /** Must be called from a click (browsers require it). */
  const startShare = useCallback(async () => {
    setShareError(null);
    if (!supported.share) { setShareError("This device can't share its screen from the browser."); return false; }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", frameRate: 5 } as MediaTrackConstraints,
        audio: false,
        // Chrome hints: offer the whole screen first, don't pre-select this tab.
        ...({ monitorTypeSurfaces: "include", selfBrowserSurface: "exclude", surfaceSwitching: "exclude" } as object)
      } as DisplayMediaStreamOptions);
      const track = s.getVideoTracks()[0];
      const kind = (track.getSettings() as { displaySurface?: string }).displaySurface ?? null;
      if (kind && kind !== "monitor") {
        s.getTracks().forEach((t) => t.stop());
        setShareError("Please choose “Entire screen” (not a window or tab) so your teacher can see your screen.");
        return false;
      }
      stream.current = s;
      const IC = FrameCapture();
      grabber.current = IC ? new IC(track) : null;
      if (!video.current) { video.current = document.createElement("video"); video.current.muted = true; video.current.playsInline = true; }
      video.current.srcObject = s;
      void video.current.play().catch(() => {});
      track.addEventListener("ended", () => { stopShare(); void report({ sharing: false }); });
      setSurface(kind); setSharing(true);
      lastThumb.current = 0;
      window.setTimeout(() => void capture("thumbnail"), 800);
      void report({ sharing: true });
      return true;
    } catch (e) {
      setShareError((e as Error).name === "NotAllowedError"
        ? "Screen sharing was cancelled. You need to share your screen to take part in this class."
        : "Couldn't start screen sharing. Try again, or ask your teacher.");
      return false;
    }
  }, [supported.share, capture, report, stopShare]);

  /** Must be called from a click. */
  const enterFullscreen = useCallback(async () => {
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* denied */ }
  }, []);

  // Focus / full-screen tracking: report immediately on every change.
  useEffect(() => {
    if (!opts.live) return;
    let hiddenShot: number | undefined;
    const onChange = () => {
      const v = lessonInFront(), f = isFullscreen();
      setVisible(v); setFullscreen(f);
      void report({ visible: v, fullscreen: f });
      window.clearTimeout(hiddenShot);
      // Grab what they switched to, for the teacher's alert.
      if (!v) hiddenShot = window.setTimeout(() => void capture("thumbnail"), 1500);
    };
    const events: [EventTarget, string][] = [[document, "visibilitychange"], [document, "fullscreenchange"], [window, "blur"], [window, "focus"]];
    events.forEach(([t, e]) => t.addEventListener(e, onChange));
    onChange();
    const tick = window.setInterval(() => void report(), 5000);
    return () => { events.forEach(([t, e]) => t.removeEventListener(e, onChange)); window.clearInterval(tick); window.clearTimeout(hiddenShot); };
  }, [opts.live, report, capture]);

  // Frames: thumbnails on the school's interval (≤5 s), sharp frames every ~2 s
  // while the teacher has this student open.
  useEffect(() => {
    if (!sharing) return;
    const id = window.setInterval(() => {
      const d = directivesRef.current;
      if (d && !d.capture.enabled) return;
      if (d?.capture.high_quality) { void capture("spotlight"); return; }
      const every = (d?.capture.interval_seconds ?? 5) * 1000;
      if (Date.now() - lastThumb.current >= every) { lastThumb.current = Date.now(); void capture("thumbnail"); }
    }, 2000);
    return () => window.clearInterval(id);
  }, [sharing, capture]);

  // School turned capture off, or the class ended: stop sharing.
  useEffect(() => {
    if ((directives && !directives.capture.enabled) || !opts.live) stopShare();
  }, [directives, opts.live, stopShare]);
  useEffect(() => () => stopShare(), [stopShare]);

  const needShare = !!directives?.capture.enabled && !opts.managedDevice && supported.share;
  const needFullscreen = supported.fullscreen && !unsupported;
  const locked = !!directives?.lockdown;
  const blocked = locked && ((needShare && !sharing) || (needFullscreen && !fullscreen) || !visible);

  return {
    directives, sharing, fullscreen, visible, unsupported, shareError,
    needShare, needFullscreen, locked, blocked,
    startShare, stopShare, enterFullscreen
  };
}
