import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { api, ApiError } from "../lib/api";
import type { PublicReviewInfo, ReviewAnalytics, ReviewKeyword, ReviewSettings } from "../lib/review-api";
import type { Program } from "../lib/loyalty-api";
import { REVIEW_LANGUAGE_LABELS, REVIEW_LANGUAGES, type ReviewLanguage } from "../../shared/domain";
import { Alert, Badge, Button, Card, Input, PageHeader, PageLoader, Select, Spinner, Textarea } from "../components/ui";
import { useBusinessContext } from "./business";
import { PlaceSearch } from "../components/PlaceSearch";
import { ReviewKeywordsEditor, saveReviewKeywords } from "../components/ReviewKeywordsEditor";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { QuickReview } from "../components/QuickReview";
import { ReviewButtonFace } from "../components/GoogleReviewSheet";
import { AdvancedSection, EditorLayout, EditorSection, PhoneFrame, SaveBar, Segmented, sameJson, useUnsavedChangesGuard } from "../components/editor";

export function ReviewsSettingsPage() {
  const { business, membership } = useBusinessContext();
  const canManage = membership.permissions.includes("reviews.manage");
  if (!canManage) {
    return (
      <>
        <PageHeader title="Google reviews" description="How customers are sharing their experience on Google." />
        <AnalyticsCard businessId={business.id} />
      </>
    );
  }
  return <ReviewsEditorLoader />;
}

function ReviewsEditorLoader() {
  const { business } = useBusinessContext();
  const settings = useQuery({
    queryKey: ["review-settings", business.id],
    queryFn: () => api<{ settings: ReviewSettings; publicPath: string }>(`/api/businesses/${business.id}/review-settings`),
  });
  const keywords = useQuery({
    queryKey: ["review-keywords", business.id],
    queryFn: () => api<{ keywords: ReviewKeyword[] }>(`/api/businesses/${business.id}/review-keywords`),
  });
  if (settings.isLoading || keywords.isLoading) return <PageLoader />;
  if (!settings.data || !keywords.data) return <Alert>Could not load review settings. Please refresh.</Alert>;
  return <ReviewsEditor settings={settings.data.settings} keywords={keywords.data.keywords} />;
}

interface ReviewForm {
  settings: ReviewSettings;
  keywords: ReviewKeyword[];
}

const kwKey = (k: ReviewKeyword[]) => k.map((x) => `${x.text}|${x.group}`);

function ReviewsEditor({ settings, keywords }: { settings: ReviewSettings; keywords: ReviewKeyword[] }) {
  const { business } = useBusinessContext();
  const qc = useQueryClient();
  const initial = useMemo<ReviewForm>(() => ({ settings, keywords }), [settings, keywords]);
  const [f, setF] = useState<ReviewForm>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewTab, setPreviewTab] = useState<"card" | "sheet">("card");
  const settingsDirty = !sameJson(f.settings, initial.settings);
  const keywordsDirty = !sameJson(kwKey(f.keywords), kwKey(initial.keywords));
  const dirty = settingsDirty || keywordsDirty;
  useUnsavedChangesGuard(dirty && !saving);

  const resync = useRef(false);
  useEffect(() => {
    if (!resync.current) return;
    resync.current = false;
    setF(initial);
  }, [initial]);

  const programs = useQuery({
    queryKey: ["programs", business.id],
    queryFn: () => api<{ programs: Program[] }>(`/api/businesses/${business.id}/programs`),
  });
  const program = programs.data?.programs.find((p) => p.status === "active");

  const s = f.settings;
  const set = <K extends keyof ReviewSettings>(k: K, v: ReviewSettings[K]) => setF((p) => ({ ...p, settings: { ...p.settings, [k]: v } }));
  const toggleLang = (l: ReviewLanguage) => set("languages", s.languages.includes(l) ? s.languages.filter((x) => x !== l) : [...s.languages, l]);

  async function save() {
    setSaving(true);
    setErrors({});
    setError(null);
    try {
      if (keywordsDirty) {
        const res = await saveReviewKeywords(business.id, f.keywords);
        qc.setQueryData(["review-keywords", business.id], res);
      }
      if (settingsDirty) {
        const res = await api<{ settings: ReviewSettings; publicPath: string }>(`/api/businesses/${business.id}/review-settings`, { method: "PUT", body: s });
        qc.setQueryData(["review-settings", business.id], res);
      }
      resync.current = true;
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setError(Object.keys(err.fieldErrors()).length ? "Please fix the highlighted fields." : err.message);
      } else setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const live = s.enabled && !!s.reviewUrl;
  const demoInfo: PublicReviewInfo = {
    business: { name: business.name, slug: business.slug, category: business.category, logoUrl: business.logoUrl },
    profileName: s.profileName || business.name,
    languages: s.languages.length ? s.languages : ["en"],
    keywords: f.keywords,
  };

  const preview = (
    <>
      <PhoneFrame>
        {previewTab === "card" ? (
          <div className="pt-2">
            <p className="mb-3 text-sm font-semibold text-zinc-500">← My cards</p>
            <LoyaltyCard
              businessName={business.name}
              logoUrl={business.logoUrl}
              programName={program?.name ?? "Loyalty card"}
              customerName="Riya Shah"
              stampIcon={program?.stampIcon ?? "star"}
              stampsRequired={program?.stampsRequired ?? 10}
              points={3}
              rewards={program?.rewards.filter((r) => r.isActive) ?? []}
            />
            {live && s.showOnCard ? (
              <ReviewButtonFace />
            ) : (
              <div className="mt-3 rounded-2xl border-2 border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500">
                {!s.enabled ? "Review button is off" : !s.reviewUrl ? "Add your Google review link to show the button" : "Button hidden under cards"}
              </div>
            )}
            <div className="mt-4 h-40 rounded-2xl bg-white/70" aria-hidden />
          </div>
        ) : (
          <div className="pt-2">
            <h3 className="text-lg font-bold tracking-tight">Review {business.name}</h3>
            <p className="mb-4 text-sm text-zinc-500">Takes about 30 seconds</p>
            <QuickReview key={kwKey(f.keywords).join() + s.languages.join()} slug={business.slug} info={demoInfo} demo />
          </div>
        )}
      </PhoneFrame>
      <Segmented
        label="Preview screen"
        value={previewTab}
        onChange={setPreviewTab}
        options={[
          { value: "card", label: "Under the card" },
          { value: "sheet", label: "✨ Try it" },
        ]}
      />
    </>
  );

  return (
    <>
      <EditorLayout
        title="Google reviews"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            Help customers share honest reviews on Google. <Badge tone={live ? "success" : "neutral"}>{live ? "Live" : "Off"}</Badge>
          </span>
        }
        preview={preview}
        previewNote={previewTab === "sheet" ? "Try it uses sample text and doesn't use your AI credits." : "Every customer sees the same button."}
        footer={<SaveBar dirty={dirty} saving={saving} saved={saved && !dirty} onSave={save} onDiscard={() => setF(initial)} error={error ?? undefined} />}
      >
        <PolicyNote />

        <EditorSection n={1} title="Turn it on">
          <div className="space-y-3">
            <ToggleRow
              checked={s.enabled}
              onChange={(v) => set("enabled", v)}
              title="Invite customers to review you on Google"
              text="Shown on your shop page and at your review link."
            />
            <ToggleRow
              checked={s.showOnCard}
              onChange={(v) => set("showOnCard", v)}
              title="Show the ⭐ button under customers' stamp cards"
              text="The easiest moment to ask: right after a visit."
            />
          </div>
        </EditorSection>

        <EditorSection n={2} title="Your Google review link" hint="Where customers are sent to post.">
          <div className="space-y-3">
            {!s.reviewUrl && (
              <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3">
                <PlaceSearch
                  label="Find your shop to get the link"
                  placeholder="Search your shop on Google Maps"
                  onPick={(p) =>
                    setF((prev) => ({
                      ...prev,
                      settings: { ...prev.settings, reviewUrl: p.reviewUrl, profileName: prev.settings.profileName || p.name, category: prev.settings.category || p.categoryLabel },
                    }))
                  }
                />
              </div>
            )}
            <Input
              label="Google review link"
              placeholder="https://g.page/r/…/review"
              value={s.reviewUrl ?? ""}
              onChange={(e) => set("reviewUrl", e.target.value)}
              error={errors.reviewUrl}
              hint="Google Business Profile → Ask for reviews → copy the link."
            />
          </div>
        </EditorSection>

        <EditorSection n={3} title="Keywords customers can pick" hint="AI writes the review only from what the customer picks, plus your shop details.">
          <ReviewKeywordsEditor
            businessId={business.id}
            selected={f.keywords}
            onChange={(k) => setF((p) => ({ ...p, keywords: k }))}
            autoSuggest={!initial.keywords.length}
          />
        </EditorSection>

        <EditorSection n={4} title="Languages" hint="Customers choose one when writing.">
          <div className="flex flex-wrap gap-2">
            {REVIEW_LANGUAGES.map((l) => (
              <label
                key={l}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${s.languages.includes(l) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-zinc-300 text-zinc-600"}`}
              >
                <input type="checkbox" className="sr-only" checked={s.languages.includes(l)} onChange={() => toggleLang(l)} />
                {s.languages.includes(l) ? "✓ " : ""}
                {REVIEW_LANGUAGE_LABELS[l]}
              </label>
            ))}
          </div>
          {errors.languages && <p className="mt-1.5 text-sm text-red-600">{errors.languages}</p>}
        </EditorSection>

        <AdvancedSection title="Shop info for the AI" hint="Name, category and services the AI uses for context">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Name on Google Maps"
                value={s.profileName ?? ""}
                onChange={(e) => set("profileName", e.target.value)}
                error={errors.profileName}
                placeholder={business.name}
              />
              <Input label="Category" value={s.category ?? ""} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Cafe" error={errors.category} />
            </div>
            <Textarea
              label="About your shop"
              value={s.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
              maxLength={500}
              rows={2}
              error={errors.description}
            />
            <Textarea label="Products / services" value={s.services ?? ""} onChange={(e) => set("services", e.target.value)} maxLength={500} rows={2} error={errors.services} />
          </div>
        </AdvancedSection>
      </EditorLayout>

      <div className="mt-8 space-y-6">
        {initial.settings.enabled && initial.settings.reviewUrl && <ShareCard url={`${window.location.origin}/s/${business.slug}/review`} slug={business.slug} />}
        <AnalyticsCard businessId={business.id} />
      </div>
    </>
  );
}

function ToggleRow({ checked, onChange, title, text }: { checked: boolean; onChange: (v: boolean) => void; title: string; text: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-3 hover:border-zinc-300">
      <input type="checkbox" className="mt-0.5 size-4 accent-brand-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">
        <span className="block font-medium text-zinc-900">{title}</span>
        <span className="block text-zinc-500">{text}</span>
      </span>
    </label>
  );
}

function PolicyNote() {
  return (
    <details className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
      <summary className="cursor-pointer font-medium">✅ How this stays within Google's review rules</summary>
      <ul className="mt-2 list-disc space-y-0.5 pl-5">
        <li>Every customer sees the same button, whatever their experience.</li>
        <li>Reviews are never rewarded and are separate from stamps.</li>
        <li>Customers pick what they actually experienced, can edit the text, and post it themselves.</li>
      </ul>
    </details>
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
