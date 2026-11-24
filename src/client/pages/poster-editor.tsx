import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { ChannelsResponse, Program } from "../lib/loyalty-api";
import { defaultPosterText, downloadCanvas, POSTER_SIZES, printPoster, renderPoster, safeFileName, type PosterFormat, type PosterTheme } from "../lib/poster";
import { Alert, Button, cx, Input, Select, Spinner } from "../components/ui";
import { EditorLayout, EditorSection } from "../components/editor";
import { useBusinessContext } from "./business";
import { EditorSkeleton } from "../components/skeletons";

const THEME_SWATCHES: { value: PosterTheme; label: string; className: string }[] = [
  { value: "brand", label: "Purple", className: "bg-gradient-to-br from-brand-500 to-indigo-400" },
  { value: "light", label: "White", className: "bg-white ring-1 ring-zinc-300" },
  { value: "dark", label: "Black", className: "bg-zinc-900" },
];

const STORE_KEY = (businessId: string) => `graahak.poster.${businessId}`;

interface Design {
  format: PosterFormat;
  theme: PosterTheme;
  headline: string;
  subline: string;
  showOffer: boolean;
  showSteps: boolean;
}

/** Poster studio: design, preview, download or print the counter QR poster. */
export function PosterEditorPage() {
  const { business } = useBusinessContext();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const channels = useQuery({ queryKey: ["channels", business.id], queryFn: () => api<ChannelsResponse>(`/api/businesses/${business.id}/channels`) });
  const programs = useQuery({ queryKey: ["programs", business.id], queryFn: () => api<{ programs: Program[] }>(`/api/businesses/${business.id}/programs`) });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  if (channels.isLoading || programs.isLoading) return <EditorSkeleton />;
  if (!channels.data) return <Alert>Could not load your QR codes. Please refresh.</Alert>;
  const codes = channels.data.qrCodes.filter((q) => q.status === "active");

  if (!codes.length) {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <p className="text-4xl">🖨️</p>
        <h1 className="mt-3 text-xl font-bold">Create your counter QR first</h1>
        <p className="mt-1 text-zinc-600">Customers scan it to open your loyalty page.</p>
        {createError && (
          <div className="mt-4">
            <Alert>{createError}</Alert>
          </div>
        )}
        <Button
          className="mt-5"
          loading={creating}
          onClick={async () => {
            setCreating(true);
            setCreateError(null);
            try {
              await api(`/api/businesses/${business.id}/qr-codes`, { body: { label: "Counter poster", locationId: null } });
              await qc.invalidateQueries({ queryKey: ["channels", business.id] });
            } catch (err) {
              setCreateError(err instanceof ApiError ? err.message : "Could not create the QR code");
            } finally {
              setCreating(false);
            }
          }}
        >
          Create QR code
        </Button>
      </div>
    );
  }

  const qr = codes.find((q) => q.id === params.get("qr")) ?? codes[0]!;
  const program = programs.data?.programs.find((p) => p.status === "active");
  const reward = program?.rewards.filter((r) => r.isActive).sort((a, b) => a.pointsRequired - b.pointsRequired).at(-1);
  return (
    <Studio
      key={qr.id}
      qr={qr}
      codes={codes}
      onPickQr={(id) => setParams({ qr: id }, { replace: true })}
      offer={program && reward ? { stamps: reward.pointsRequired, reward: reward.name } : null}
    />
  );
}

function Studio({
  qr,
  codes,
  onPickQr,
  offer,
}: {
  qr: ChannelsResponse["qrCodes"][number];
  codes: ChannelsResponse["qrCodes"];
  onPickQr: (id: string) => void;
  offer: { stamps: number; reward: string } | null;
}) {
  const { business } = useBusinessContext();
  const defaults = useMemo(() => defaultPosterText(business.name, offer), [business.name, offer]);
  const [d, setD] = useState<Design>(() => {
    const base: Design = { format: "poster", theme: "brand", headline: defaults.headline, subline: defaults.subline, showOffer: true, showSteps: true };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY(business.id)) ?? "null") as Partial<Design> | null;
      return saved ? { ...base, ...saved } : base;
    } catch {
      return base;
    }
  });
  const [image, setImage] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [paper, setPaper] = useState<"A4" | "A5" | "A6">("A4");
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Design>(k: K, v: Design[K]) => setD((p) => ({ ...p, [k]: v }));

  const options = useMemo(
    () => ({
      format: d.format,
      theme: d.theme,
      qrValue: qr.url,
      businessName: business.name,
      logoUrl: business.logoUrl,
      headline: d.headline,
      subline: d.subline,
      offer: d.showOffer ? defaults.offer : null,
      showSteps: d.showSteps,
    }),
    [d, qr.url, business.name, business.logoUrl, defaults.offer],
  );

  // Re-draw shortly after the owner stops typing; remember the design on this device.
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    const t = setTimeout(async () => {
      try {
        const canvas = await renderPoster(options);
        if (!cancelled) setImage(canvas.toDataURL("image/png"));
      } catch {
        if (!cancelled) setError("Couldn't draw the poster. Please try again.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 250);
    try {
      localStorage.setItem(STORE_KEY(business.id), JSON.stringify(d));
    } catch {
      // Private mode: the design just isn't remembered.
    }
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [options, d, business.id]);

  const fileName = `${safeFileName(business.name)}-${d.format}.png`;
  async function download() {
    downloadCanvas(await renderPoster(options), fileName);
  }

  const size = POSTER_SIZES[d.format];
  const preview = (
    <div className="space-y-3">
      <div className="relative mx-auto overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-zinc-200" style={{ aspectRatio: `${size.w} / ${size.h}`, maxWidth: d.format === "status" ? 260 : 340 }}>
        {image ? <img src={image} alt="Poster preview" className="size-full object-contain" /> : <div className="size-full animate-pulse bg-zinc-100" />}
        {rendering && image && (
          <span className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-zinc-500 shadow">
            <Spinner className="size-4" />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Button className="w-full" onClick={download} disabled={!image}>
          ⬇️ Download {d.format === "poster" ? "poster" : "image"} (PNG)
        </Button>
        {d.format === "poster" && (
          <div className="flex gap-2">
            <Select label="" aria-label="Paper size" value={paper} onChange={(e) => setPaper(e.target.value as typeof paper)}>
              <option value="A4">A4 (wall poster)</option>
              <option value="A5">A5 (counter)</option>
              <option value="A6">A6 (table stand)</option>
            </Select>
            <Button
              variant="secondary"
              className="shrink-0"
              disabled={!image}
              onClick={() => image && !printPoster(image, paper, `${business.name} poster`) && setError("Allow pop-ups to print, or download the PNG instead.")}
            >
              🖨️ Print
            </Button>
          </div>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );

  return (
    <EditorLayout
      back={{ to: `/app/b/${business.id}/qr-nfc`, label: "QR posters & NFC" }}
      title="Design your poster"
      subtitle="Print it for the counter or share it on WhatsApp. The preview is exactly what you'll get."
      previewLabel="Poster preview"
      preview={preview}
    >
      <EditorSection n={1} title="What are you making?">
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(POSTER_SIZES) as PosterFormat[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => set("format", fmt)}
              aria-pressed={d.format === fmt}
              className={cx(
                "rounded-xl border p-3 text-left transition",
                d.format === fmt ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20" : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <span className="block text-xl" aria-hidden>
                {fmt === "poster" ? "🖨️" : fmt === "status" ? "📱" : "🟪"}
              </span>
              <span className="mt-1 block text-sm font-semibold">{POSTER_SIZES[fmt].label}</span>
              <span className="block text-xs text-zinc-500">{POSTER_SIZES[fmt].hint}</span>
            </button>
          ))}
        </div>
      </EditorSection>

      <EditorSection n={2} title="Words on the poster" hint="Short and clear works best from a distance.">
        <div className="space-y-4">
          <Input label="Big headline" value={d.headline} onChange={(e) => set("headline", e.target.value)} maxLength={60} />
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {[defaults.headline, "Scan & join free!", "Your loyalty card is here 🎉", "Every visit counts!"]
              .filter((x, i, a) => a.indexOf(x) === i)
              .map((h) => (
                <button key={h} type="button" onClick={() => set("headline", h)} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-200">
                  {h}
                </button>
              ))}
          </div>
          <Input label="Small line under it" value={d.subline} onChange={(e) => set("subline", e.target.value)} maxLength={90} />
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-brand-500" checked={d.showOffer} disabled={!defaults.offer} onChange={(e) => set("showOffer", e.target.checked)} />
            <span>
              Show the offer {defaults.offer ? <b>“{defaults.offer}”</b> : <span className="text-zinc-500">(create a stamp card first)</span>}
            </span>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-brand-500" checked={d.showSteps} disabled={d.format === "square"} onChange={(e) => set("showSteps", e.target.checked)} />
            <span>Show “Scan · Join · Get rewards” steps {d.format === "square" && <span className="text-zinc-500">(not on square posts)</span>}</span>
          </label>
          <button
            type="button"
            className="text-sm font-medium text-brand-600 hover:underline"
            onClick={() => setD((p) => ({ ...p, headline: defaults.headline, subline: defaults.subline, showOffer: true, showSteps: true }))}
          >
            Reset text
          </button>
        </div>
      </EditorSection>

      <EditorSection n={3} title="Colour">
        <div className="flex gap-3">
          {THEME_SWATCHES.map((t) => (
            <button key={t.value} type="button" onClick={() => set("theme", t.value)} aria-pressed={d.theme === t.value} className="flex flex-col items-center gap-1.5 text-xs">
              <span className={cx("size-12 rounded-xl", t.className, d.theme === t.value && "outline outline-2 outline-offset-2 outline-brand-500")} />
              {t.label}
            </button>
          ))}
        </div>
        {!business.logoUrl && (
          <p className="mt-3 text-sm text-zinc-500">
            Tip: <Link to={`/app/b/${business.id}/settings`} className="font-medium text-brand-600 hover:underline">add your logo</Link> to show it on the poster.
          </p>
        )}
      </EditorSection>

      {codes.length > 1 && (
        <EditorSection n={4} title="Which QR code?" hint="Each code counts its own scans, so you can compare counters or tables.">
          <Select label="" aria-label="QR code" value={qr.id} onChange={(e) => onPickQr(e.target.value)}>
            {codes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.scanCount} scans)
              </option>
            ))}
          </Select>
        </EditorSection>
      )}
    </EditorLayout>
  );
}
