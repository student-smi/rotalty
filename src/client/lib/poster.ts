import QRCode from "qrcode";
import { BRAND } from "./brand";

/**
 * Draws counter posters / WhatsApp status images on a canvas. The dashboard preview, the PNG download
 * and the print view all come from this one function, so what the owner sees is exactly what prints.
 */
export type PosterFormat = "poster" | "status" | "square";
export type PosterTheme = "brand" | "light" | "dark";

export interface PosterOptions {
  format: PosterFormat;
  theme: PosterTheme;
  qrValue: string;
  businessName: string;
  logoUrl: string | null;
  headline: string;
  subline: string;
  offer: string | null;
  showSteps: boolean;
}

export const POSTER_SIZES: Record<PosterFormat, { w: number; h: number; label: string; hint: string }> = {
  poster: { w: 1240, h: 1754, label: "Counter poster", hint: "Print on A4, A5 or A6" },
  status: { w: 1080, h: 1920, label: "WhatsApp status", hint: "Also for Instagram stories" },
  square: { w: 1080, h: 1080, label: "Square post", hint: "WhatsApp, Instagram, Facebook" },
};

const THEMES: Record<PosterTheme, { bg: string; bg2: string; text: string; muted: string; accent: string; pill: string; pillText: string }> = {
  brand: { bg: "#5b5bd6", bg2: "#818cf8", text: "#ffffff", muted: "rgba(255,255,255,0.85)", accent: "#ffffff", pill: "#ffffff", pillText: "#4141a8" },
  light: { bg: "#ffffff", bg2: "#eef0ff", text: "#18181b", muted: "#52525b", accent: "#5b5bd6", pill: "#5b5bd6", pillText: "#ffffff" },
  dark: { bg: "#18181b", bg2: "#27272a", text: "#ffffff", muted: "#d4d4d8", accent: "#a5b4fc", pill: "#fbbf24", pillText: "#18181b" },
};

const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/\s+\S*$/, "")}…`;
    return kept;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export async function renderPoster(o: PosterOptions): Promise<HTMLCanvasElement> {
  const { w: W, h: H } = POSTER_SIZES[o.format];
  const t = THEMES[o.theme];
  const u = W / 100; // layout unit
  await Promise.all([document.fonts?.load(`700 ${Math.round(6 * u)}px Inter`), document.fonts?.load(`500 ${Math.round(3 * u)}px Inter`)]).catch(() => undefined);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, t.bg);
  grad.addColorStop(1, t.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  if (o.theme !== "light") {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.arc(W * 0.92, H * 0.06, W * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(W * 0.04, H * 0.97, W * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }

  const square = o.format === "square";
  const pad = 7 * u;
  const contentW = W - pad * 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Measure text blocks first so the QR can take whatever space is left.
  const headSize = (square ? 6.2 : 7.2) * u;
  ctx.font = `800 ${headSize}px ${FONT}`;
  const headLines = wrap(ctx, o.headline || "Scan to join", contentW, 2);
  const subSize = (square ? 3.1 : 3.5) * u;
  ctx.font = `500 ${subSize}px ${FONT}`;
  const subLines = o.subline ? wrap(ctx, o.subline, contentW, 2) : [];

  const logoSize = (square ? 9 : 12) * u;
  const brandBlock = logoSize + 2.5 * u + 4.2 * u; // logo + gap + name
  const headBlock = headLines.length * headSize * 1.12;
  const subBlock = subLines.length ? 1.8 * u + subLines.length * subSize * 1.3 : 0;
  const offerBlock = o.offer ? 3.5 * u + 7.5 * u : 0;
  const stepsBlock = o.showSteps && !square ? 4 * u + 11 * u : 0;
  const footerBlock = 6 * u;
  const gaps = 4 * u + 4 * u; // around QR card
  const qrCardPad = 3 * u;
  const qrCaption = 4.2 * u;
  const fixed = brandBlock + 3.5 * u + headBlock + subBlock + gaps + qrCardPad * 2 + qrCaption + offerBlock + stepsBlock + footerBlock;
  const qrSize = Math.max(28 * u, Math.min((square ? 40 : 62) * u, H - pad * 2 - fixed));
  const total = fixed + qrSize;
  let y = Math.max(pad, (H - total) / 2);

  // Logo + business name
  const cx = W / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.clip();
  let drewLogo = false;
  if (o.logoUrl) {
    try {
      const img = await loadImage(o.logoUrl);
      ctx.drawImage(img, cx - logoSize / 2, y, logoSize, logoSize);
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) {
    ctx.fillStyle = "#5b5bd6";
    ctx.fillRect(cx - logoSize / 2, y, logoSize, logoSize);
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${logoSize * 0.48}px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText((o.businessName[0] ?? "?").toUpperCase(), cx, y + logoSize / 2 + logoSize * 0.03);
    ctx.textBaseline = "top";
  }
  ctx.restore();
  if (o.theme === "light") {
    ctx.strokeStyle = "#e4e4e7";
    ctx.lineWidth = Math.max(2, 0.3 * u);
    ctx.beginPath();
    ctx.arc(cx, y + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  y += logoSize + 2.5 * u;
  ctx.fillStyle = t.text;
  ctx.font = `700 ${3.6 * u}px ${FONT}`;
  ctx.fillText(o.businessName, cx, y, contentW);
  y += 4.2 * u + 3.5 * u;

  // Headline + subline
  ctx.fillStyle = t.text;
  ctx.font = `800 ${headSize}px ${FONT}`;
  for (const line of headLines) {
    ctx.fillText(line, cx, y, contentW);
    y += headSize * 1.12;
  }
  if (subLines.length) {
    y += 1.8 * u;
    ctx.fillStyle = t.muted;
    ctx.font = `500 ${subSize}px ${FONT}`;
    for (const line of subLines) {
      ctx.fillText(line, cx, y, contentW);
      y += subSize * 1.3;
    }
  }

  // QR card
  y += 4 * u;
  const cardW = qrSize + qrCardPad * 2;
  const cardH = qrSize + qrCardPad * 2 + qrCaption;
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 3 * u;
  ctx.shadowOffsetY = 0.8 * u;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, cx - cardW / 2, y, cardW, cardH, 3.5 * u);
  ctx.fill();
  ctx.shadowColor = "transparent";
  if (o.theme === "light") {
    ctx.strokeStyle = "#e4e4e7";
    ctx.lineWidth = Math.max(2, 0.25 * u);
    roundRect(ctx, cx - cardW / 2, y, cardW, cardH, 3.5 * u);
    ctx.stroke();
  }
  const qrImg = await loadImage(await QRCode.toDataURL(o.qrValue, { width: Math.round(qrSize), margin: 0, errorCorrectionLevel: "M" }));
  ctx.drawImage(qrImg, cx - qrSize / 2, y + qrCardPad, qrSize, qrSize);
  ctx.fillStyle = "#52525b";
  ctx.font = `600 ${2.5 * u}px ${FONT}`;
  ctx.fillText("Scan with your phone camera", cx, y + qrCardPad + qrSize + 1.2 * u, cardW);
  y += cardH + 4 * u;

  // Offer pill
  if (o.offer) {
    y += 0.5 * u;
    ctx.font = `700 ${3.2 * u}px ${FONT}`;
    const text = o.offer;
    const pw = Math.min(contentW, ctx.measureText(text).width + 7 * u);
    const ph = 7.5 * u;
    ctx.fillStyle = t.pill;
    roundRect(ctx, cx - pw / 2, y, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = t.pillText;
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, y + ph / 2, pw - 4 * u);
    ctx.textBaseline = "top";
    y += ph + 3 * u;
  }

  // Steps
  if (o.showSteps && !square) {
    y += 1 * u;
    const steps: [string, string][] = [
      ["📱", "1. Scan"],
      ["✍️", "2. Join free"],
      ["🎁", "3. Get rewards"],
    ];
    const colW = contentW / 3;
    steps.forEach(([icon, label], i) => {
      const x = pad + colW * i + colW / 2;
      ctx.font = `${5.2 * u}px ${FONT}`;
      ctx.fillStyle = t.text;
      ctx.fillText(icon, x, y);
      ctx.font = `700 ${2.9 * u}px ${FONT}`;
      ctx.fillText(label, x, y + 6.8 * u, colW - u);
    });
    y += 11 * u + 4 * u;
  }

  // Footer
  ctx.fillStyle = t.muted;
  ctx.font = `500 ${2.2 * u}px ${FONT}`;
  ctx.fillText(`No app needed · ${BRAND}`, cx, Math.min(H - pad * 0.6 - 2.2 * u, Math.max(y, H - pad - 2.2 * u)), contentW);
  return canvas;
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
}

/** Opens a print view with the poster filling the chosen paper size. */
export function printPoster(dataUrl: string, paper: "A4" | "A5" | "A6", title: string) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  w.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
@page { size: ${paper} portrait; margin: 0; }
html,body { margin: 0; height: 100%; }
img { display: block; width: 100%; height: 100vh; object-fit: contain; }
</style></head><body><img src="${dataUrl}" onload="setTimeout(function(){window.print()},150)" alt=""></body></html>`);
  w.document.close();
  return true;
}

export function defaultPosterText(businessName: string, offer: { stamps: number; reward: string } | null) {
  return {
    headline: offer ? `Collect stamps, get ${offer.reward.replace(/^./, (c) => c.toLowerCase())}!` : "Collect stamps, get rewards!",
    subline: `Scan to join ${businessName}'s loyalty card. It's free.`,
    offer: offer ? `${offer.stamps} stamps = ${offer.reward}` : null,
  };
}

export const safeFileName = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "poster";
