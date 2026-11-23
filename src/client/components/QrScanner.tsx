import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Alert, Button, Spinner } from "./ui";

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

type ScanError = "insecure" | "unsupported" | "denied" | "no-camera" | "other";

const ERROR_TEXT: Record<ScanError, string> = {
  insecure: "The camera needs a secure (https) connection.",
  unsupported: "This browser can't open the camera.",
  denied: "Camera permission was denied. Allow camera access in your browser settings, then try again.",
  "no-camera": "No camera was found on this device.",
  other: "Could not start the camera.",
};

/**
 * Continuously scans QR codes from the rear camera while `active`.
 * Uses the native BarcodeDetector when available, falling back to jsQR on canvas frames.
 */
export function QrScanner({ active, onResult }: { active: boolean; onResult: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState<ScanError | null>(null);
  const [starting, setStarting] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let lastScan = 0;
    let busy = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    let detector: BarcodeDetectorLike | null = null;
    try {
      detector = Detector ? new Detector({ formats: ["qr_code"] }) : null;
    } catch {
      detector = null;
    }

    async function tick(ts: number) {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (busy || !video || video.readyState < 2 || ts - lastScan < 200) return;
      lastScan = ts;
      busy = true;
      try {
        let text: string | null = null;
        if (detector) {
          const codes = await detector.detect(video);
          text = codes[0]?.rawValue ?? null;
        } else if (ctx) {
          const w = video.videoWidth;
          const h = video.videoHeight;
          const scale = Math.min(1, 640 / Math.max(w, h));
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
        }
        if (text && !stopped) onResultRef.current(text);
      } catch {
        // Detector errors on individual frames are transient; keep scanning.
      } finally {
        busy = false;
      }
    }

    (async () => {
      setError(null);
      setStarting(true);
      if (!window.isSecureContext) return setError("insecure");
      if (!navigator.mediaDevices?.getUserMedia) return setError("unsupported");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch (e) {
        const name = (e as Error)?.name;
        setError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "no-camera" : "other");
        return;
      } finally {
        setStarting(false);
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [active, attempt]);

  if (error) {
    return (
      <div className="space-y-3">
        <Alert tone="warning">{ERROR_TEXT[error]}</Alert>
        {error !== "insecure" && error !== "unsupported" && (
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-zinc-900">
      <video ref={videoRef} className="size-full object-cover" playsInline muted />
      {starting && (
        <div className="absolute inset-0 flex items-center justify-center text-white/80">
          <Spinner className="size-7" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-[15%] rounded-2xl border-4 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
      {!active && <div className="absolute inset-0 bg-zinc-900/70" />}
    </div>
  );
}
