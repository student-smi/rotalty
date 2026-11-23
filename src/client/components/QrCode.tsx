import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cx } from "./ui";

export function QrCode({ value, size = 220, className, label }: { value: string; size?: number; className?: string; label?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  return src ? (
    <img src={src} width={size} height={size} alt={label ?? "QR code"} className={cx("block bg-white", className)} />
  ) : (
    <div style={{ width: size, height: size }} className={cx("animate-pulse rounded-lg bg-zinc-100", className)} />
  );
}

function download(href: string, filename: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "qr";

/** Poster-ready PNG with the label printed under the code. */
export async function downloadQrPng(value: string, label: string, title: string) {
  const qr = await QRCode.toDataURL(value, { width: 900, margin: 2, errorCorrectionLevel: "M" });
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = qr;
  });
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#18181b";
  ctx.textAlign = "center";
  ctx.font = "600 44px Inter, system-ui, sans-serif";
  ctx.fillText(title, 450, 70, 840);
  ctx.drawImage(img, 0, 100, 900, 900);
  ctx.font = "400 32px Inter, system-ui, sans-serif";
  ctx.fillStyle = "#52525b";
  ctx.fillText(label, 450, 1050, 840);
  download(canvas.toDataURL("image/png"), `${safeName(title)}-${safeName(label)}.png`);
}

export async function downloadQrSvg(value: string, label: string, title: string) {
  const svg = await QRCode.toString(value, { type: "svg", margin: 2, errorCorrectionLevel: "M" });
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 33 33";
  const size = Number(viewBox.split(" ")[2]) || 33;
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + 8}" width="900" height="${Math.round((900 * (size + 8)) / size)}">
<rect width="100%" height="100%" fill="#fff"/>
<text x="${size / 2}" y="2.6" font-family="Inter, sans-serif" font-size="2" font-weight="600" text-anchor="middle" fill="#18181b">${esc(title)}</text>
<g transform="translate(0 4)">${inner}</g>
<text x="${size / 2}" y="${size + 6.5}" font-family="Inter, sans-serif" font-size="1.5" text-anchor="middle" fill="#52525b">${esc(label)}</text>
</svg>`;
  const url = URL.createObjectURL(new Blob([doc], { type: "image/svg+xml" }));
  download(url, `${safeName(title)}-${safeName(label)}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
