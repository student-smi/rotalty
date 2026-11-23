import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api, ApiError } from "../lib/api";
import type { ReviewAnalytics, ReviewSettings } from "../lib/review-api";
import { REVIEW_LANGUAGE_LABELS, REVIEW_LANGUAGES, type ReviewLanguage } from "../../shared/domain";
import { Alert, Badge, Button, Card, Input, PageHeader, PageLoader, Select, Spinner, Textarea } from "../components/ui";
import { useBusinessContext } from "./business";
import { PlaceSearch } from "../components/PlaceSearch";

export function ReviewsSettingsPage() {
  const { business, membership } = useBusinessContext();
  const canManage = membership.permissions.includes("reviews.manage");
  return (
    <>
      <PageHeader title="AI Review Assistant" description="Help customers turn their own feedback into a Google review draft." />
      <div className="space-y-6">
        <PolicyNote />
        {canManage && <SettingsCard businessId={business.id} slug={business.slug} />}
        <AnalyticsCard businessId={business.id} />
      </div>
    </>
  );
}

function PolicyNote() {
  return (
    <Alert tone="info">
      <p className="font-medium">How this stays within Google's review policies</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        <li>Every customer sees the same optional invitation, whatever their experience. Never ask only happy customers.</li>
        <li>Reviews are never rewarded and are completely separate from loyalty points.</li>
        <li>Drafts use only what the customer typed. Customers edit and post the review themselves on Google; nothing is posted automatically.</li>
      </ul>
    </Alert>
  );
}

function SettingsCard({ businessId, slug }: { businessId: string; slug: string }) {
  const qc = useQueryClient();
  const key = ["review-settings", businessId];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api<{ settings: ReviewSettings; publicPath: string }>(`/api/businesses/${businessId}/review-settings`),
  });
  const [form, setForm] = useState<ReviewSettings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(data.settings);
  }, [data, form]);

  if (isLoading || (!form && !error)) return <Card title="Settings"><div className="flex justify-center py-6 text-zinc-400"><Spinner /></div></Card>;
  if (error || !form) return <Alert>Could not load review settings.</Alert>;

  const set = <K extends keyof ReviewSettings>(k: K, v: ReviewSettings[K]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };
  const toggleLang = (l: ReviewLanguage) =>
    set("languages", form.languages.includes(l) ? form.languages.filter((x) => x !== l) : [...form.languages, l]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await api<{ settings: ReviewSettings }>(`/api/businesses/${businessId}/review-settings`, { method: "PUT", body: form });
      setForm(res.settings);
      qc.setQueryData(key, { ...data, settings: res.settings });
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.message);
      } else setFormError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const publicUrl = `${window.location.origin}/s/${slug}/review`;

  return (
    <>
      <Card
        title="Settings"
        actions={<Badge tone={data?.settings.enabled ? "success" : "neutral"}>{data?.settings.enabled ? "Live" : "Off"}</Badge>}
      >
        <form onSubmit={onSubmit} className="space-y-4">
          {formError && <Alert>{formError}</Alert>}
          {saved && <Alert tone="success">Settings saved</Alert>}
          <label className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-brand-500"
              checked={form.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-medium text-zinc-900">Show "Share your experience" to customers</span>
              <span className="block text-zinc-500">Appears on your loyalty page and at the public link below.</span>
            </span>
          </label>
          {!form.reviewUrl && (
            <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-3">
              <PlaceSearch
                label="Don't know your review link? Find your shop"
                placeholder="Search your shop on Google Maps"
                onPick={(p) => {
                  setForm((f) => (f ? { ...f, reviewUrl: p.reviewUrl, profileName: f.profileName || p.name, category: f.category || p.categoryLabel } : f));
                  setSaved(false);
                }}
              />
            </div>
          )}
          <Input
            label="Google review link"
            placeholder="https://g.page/r/…/review"
            value={form.reviewUrl ?? ""}
            onChange={(e) => set("reviewUrl", e.target.value)}
            error={errors.reviewUrl}
            hint="Google Business Profile → Ask for reviews / Share review form → copy the link. Must be an https Google link."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Google Business Profile name"
              value={form.profileName ?? ""}
              onChange={(e) => set("profileName", e.target.value)}
              error={errors.profileName}
              hint="As it appears on Google Maps"
            />
            <Input label="Category" value={form.category ?? ""} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Cafe" error={errors.category} />
          </div>
          <Textarea
            label="Business description"
            value={form.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
            maxLength={500}
            error={errors.description}
            hint="Only used to spell your business correctly. Drafts never describe things the customer didn't mention."
          />
          <Textarea label="Services" value={form.services ?? ""} onChange={(e) => set("services", e.target.value)} maxLength={500} error={errors.services} />
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-zinc-700">Languages offered</legend>
            <div className="flex flex-wrap gap-2">
              {REVIEW_LANGUAGES.map((l) => (
                <label
                  key={l}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${form.languages.includes(l) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-zinc-300 text-zinc-600"}`}
                >
                  <input type="checkbox" className="sr-only" checked={form.languages.includes(l)} onChange={() => toggleLang(l)} />
                  {REVIEW_LANGUAGE_LABELS[l]}
                </label>
              ))}
            </div>
            {errors.languages && <p className="mt-1 text-xs text-red-600">{errors.languages}</p>}
          </fieldset>
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>Save settings</Button>
          </div>
        </form>
      </Card>
      {data?.settings.enabled && <ShareCard url={publicUrl} slug={slug} />}
    </>
  );
}

function ShareCard({ url, slug }: { url: string; slug: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(url, { width: 512, margin: 2 }).then(setQr).catch(() => setQr(null));
  }, [url]);
  return (
    <Card title="Share with customers" description="Place this QR at the counter or send the link. Offer it to every customer.">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {qr ? (
          <img src={qr} alt="QR code for the review assistant" className="size-40 rounded-lg border border-zinc-200" />
        ) : (
          <div className="flex size-40 items-center justify-center rounded-lg border border-zinc-200 text-zinc-400"><Spinner /></div>
        )}
        <div className="min-w-0 flex-1 space-y-3">
          <code className="block break-all rounded-md bg-zinc-50 px-2 py-1.5 text-xs text-zinc-800">{url}</code>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }}>
              {copied ? "Copied" : "Copy link"}
            </Button>
            {qr && (
              <a href={qr} download={`review-qr-${slug}.png`}>
                <Button size="sm" variant="secondary" type="button">Download QR (PNG)</Button>
              </a>
            )}
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="ghost" type="button">Preview</Button>
            </a>
          </div>
        </div>
      </div>
    </Card>
  );
}

function AnalyticsCard({ businessId }: { businessId: string }) {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useQuery({
    queryKey: ["review-analytics", businessId, days],
    queryFn: () => api<ReviewAnalytics>(`/api/businesses/${businessId}/review-analytics?days=${days}`),
  });

  return (
    <Card
      title="Review assistant activity"
      actions={
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36" aria-label="Date range">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
      }
    >
      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <Alert>Could not load activity.</Alert>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Assistant visits" value={data.visits} />
            <Tile label="Draft sets generated" value={data.generations} />
            <Tile label="Drafts written" value={data.draftsGenerated} />
            <Tile label="Google review link clicks" value={data.redirectClicks} hint="Clicks only, not confirmed reviews" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm font-medium text-zinc-700">Languages</p>
              {Object.keys(data.languages).length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">No drafts yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {Object.entries(data.languages).map(([lang, n]) => (
                    <li key={lang} className="flex justify-between text-sm">
                      <span>{REVIEW_LANGUAGE_LABELS[lang as ReviewLanguage] ?? lang}</span>
                      <span className="tabular-nums text-zinc-600">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm font-medium text-zinc-700">AI usage</p>
              <dl className="mt-2 space-y-1.5 text-sm">
                <Row k="This month" v={`${data.monthly.used} / ${data.monthly.limit ?? "unlimited"} (${data.monthly.plan})`} />
                <Row k="Requests in range" v={`${data.ai.calls} (${data.ai.errors} failed)`} />
                <Row k="Tokens in / out" v={`${data.ai.inputTokens.toLocaleString("en-IN")} / ${data.ai.outputTokens.toLocaleString("en-IN")}`} />
                <Row k="Estimated cost" v={`$${data.ai.estimatedCostUsd.toFixed(4)}`} />
              </dl>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString("en-IN")}</p>
      {hint && <p className="mt-0.5 text-[11px] text-zinc-400">{hint}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="text-right tabular-nums text-zinc-800">{v}</dd>
    </div>
  );
}
