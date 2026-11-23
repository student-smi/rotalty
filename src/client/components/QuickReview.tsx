import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../lib/api";
import { captchaHeaders, TURNSTILE_SITE_KEY } from "../lib/auth";
import { reviewFetch, type DraftsResponse, type DraftStyle, type PublicReviewInfo } from "../lib/review-api";
import { REVIEW_LANGUAGE_LABELS, type ReviewLanguage } from "../../shared/domain";
import { Turnstile } from "./Turnstile";
import { Alert, Button, cx, Spinner } from "./ui";

type Mood = "great" | "okay" | "not_great";

const MOODS: { value: Mood; emoji: string; label: string }[] = [
  { value: "great", emoji: "😊", label: "Great" },
  { value: "okay", emoji: "🙂", label: "Okay" },
  { value: "not_great", emoji: "😕", label: "Not great" },
];

const STYLE_LABELS: Record<DraftStyle, string> = { short: "Short", friendly: "Friendly", detailed: "Detailed" };
const MAX_PICKS = 4;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function useReviewInfo(slug: string, enabled = true) {
  return useQuery({
    queryKey: ["review-info", slug],
    queryFn: () => reviewFetch<PublicReviewInfo>(`/api/public/review/${encodeURIComponent(slug)}`),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Customer review helper: rating + keywords from their own visit → 3 AI drafts → copy + open Google.
 * Google doesn't let any site pre-fill its review box, so the chosen draft is copied for the customer to paste.
 */
export function QuickReview({ slug, info }: { slug: string; info: PublicReviewInfo }) {
  const [lang, setLang] = useState<ReviewLanguage>(info.languages[0] ?? "en");
  const [mood, setMood] = useState<Mood | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setCaptcha(t), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [result, setResult] = useState<DraftsResponse | null>(null);
  const [texts, setTexts] = useState<Record<DraftStyle, string> | null>(null);
  const [editing, setEditing] = useState<DraftStyle | null>(null);
  const [sent, setSent] = useState<DraftStyle | "own" | null>(null);

  const hasKeywords = info.keywords.length > 0;
  const ready = !!mood && (picked.length > 0 || (!hasKeywords && note.trim().length >= 3)) && (!TURNSTILE_SITE_KEY || !!captcha);

  function toggle(k: string) {
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= MAX_PICKS ? p : [...p, k]));
  }

  async function generate() {
    if (!mood) return;
    setLoading(true);
    setError(null);
    try {
      const res = await reviewFetch<DraftsResponse>(`/api/public/review/${encodeURIComponent(slug)}/drafts`, {
        body: { language: lang, picks: { mood, keywords: picked, note: note.trim() }, sessionId: result?.sessionId },
        headers: captchaHeaders(captcha),
      });
      setResult(res);
      setTexts(Object.fromEntries(res.drafts.map((d) => [d.style, d.text])) as Record<DraftStyle, string>);
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? { code: err.code, message: err.message } : { code: "UNKNOWN", message: "Something went wrong. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  /** Open the tab inside the tap (so it isn't blocked as a popup), copy the text, then point the tab at Google. */
  async function openGoogle(style: DraftStyle | "own") {
    // Start copying while this page still has focus, then open the tab inside the same tap.
    const copying = style !== "own" && texts ? copyText(texts[style]) : Promise.resolve(true);
    const tab = window.open("about:blank", "_blank");
    await copying;
    try {
      const path =
        style !== "own" && result
          ? `/api/public/review/sessions/${result.sessionId}/redirect`
          : `/api/public/review/${encodeURIComponent(slug)}/redirect`;
      const { url } = await reviewFetch<{ url: string }>(path, { method: "POST", body: style !== "own" ? { style } : {} });
      setSent(style);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      setError({ code: "REDIRECT", message: "Couldn't open Google Reviews. Please try again." });
    }
  }

  const softError = error && ["AI_UNAVAILABLE", "AI_RATE_LIMITED", "AI_ERROR", "AI_INVALID_RESPONSE", "PLAN_LIMIT_REACHED", "REGENERATE_LIMIT"].includes(error.code);

  return (
    <div className="space-y-5">
      {info.languages.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Review language">
          {info.languages.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={lang === l}
              onClick={() => setLang(l)}
              className={cx(
                "rounded-full px-3 py-1 text-sm font-medium transition",
                lang === l ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200",
              )}
            >
              {REVIEW_LANGUAGE_LABELS[l]}
            </button>
          ))}
        </div>
      )}

      <section>
        <p className="mb-2 text-sm font-semibold text-zinc-900">1. How was your visit?</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How was your visit">
          {MOODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mood === m.value}
              onClick={() => setMood(m.value)}
              className={cx(
                "flex flex-col items-center gap-1 rounded-xl border py-3 text-sm font-medium transition",
                mood === m.value ? "border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/20" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
              )}
            >
              <span className="text-2xl" aria-hidden>
                {m.emoji}
              </span>
              {m.label}
            </button>
          ))}
        </div>
      </section>

      {hasKeywords && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-zinc-900">2. {mood === "not_great" ? "What was it about?" : "What did you like?"}</p>
            <span className="text-xs text-zinc-500">
              {picked.length}/{MAX_PICKS}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {info.keywords.map((k) => {
              const on = picked.includes(k.text);
              const full = !on && picked.length >= MAX_PICKS;
              return (
                <button
                  key={k.text}
                  type="button"
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggle(k.text)}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    on ? "border-brand-500 bg-brand-500 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-brand-400",
                    full && "opacity-40",
                  )}
                >
                  {on ? "✓ " : ""}
                  {k.text}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-zinc-500">Pick only what you actually had or noticed today.</p>
        </section>
      )}

      <section>
        <label htmlFor="qr-note" className="mb-1.5 block text-sm font-semibold text-zinc-900">
          {hasKeywords ? "3. Anything else? " : "2. Tell us in a few words "}
          {hasKeywords && <span className="font-normal text-zinc-500">(optional)</span>}
        </label>
        <input
          id="qr-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="e.g. tried the new cold coffee"
          className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
        />
      </section>

      {!result && <Turnstile onToken={onToken} />}

      <Button className="h-12 w-full text-base" onClick={generate} loading={loading} disabled={!ready || (result?.generationsLeft ?? 1) <= 0}>
        {result ? "✨ Write 3 new reviews" : "✨ Write my review"}
      </Button>

      {error && (
        <Alert tone={softError ? "warning" : "error"}>
          <p>{error.message}</p>
          {softError && (
            <button onClick={() => openGoogle("own")} className="mt-2 font-medium underline">
              Write my own review on Google
            </button>
          )}
        </Alert>
      )}

      {result && texts && (
        <section className="space-y-3" aria-live="polite">
          <p className="text-sm font-semibold text-zinc-900">Pick one. We'll copy it and open Google for you.</p>
          {result.drafts.map((d) => (
            <div key={d.style} className={cx("rounded-2xl border bg-white p-4 shadow-sm", sent === d.style ? "border-emerald-400" : "border-zinc-200")}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{STYLE_LABELS[d.style]}</span>
                <button type="button" onClick={() => setEditing(editing === d.style ? null : d.style)} className="text-xs font-medium text-brand-600 hover:underline">
                  {editing === d.style ? "Done" : "✏️ Edit"}
                </button>
              </div>
              {editing === d.style ? (
                <textarea
                  value={texts[d.style]}
                  onChange={(e) => setTexts({ ...texts, [d.style]: e.target.value })}
                  rows={Math.min(8, Math.max(3, Math.ceil(texts[d.style].length / 40)))}
                  className="block w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-relaxed focus:border-brand-500 focus:bg-white focus:outline-none"
                />
              ) : (
                <p className="text-sm leading-relaxed text-zinc-800">{texts[d.style]}</p>
              )}
              <Button className="mt-3 w-full" variant={sent === d.style ? "secondary" : "primary"} onClick={() => openGoogle(d.style)}>
                {sent === d.style ? "✓ Copied — open Google again" : "Use this review →"}
              </Button>
            </div>
          ))}
          {loading && (
            <div className="flex justify-center text-zinc-400">
              <Spinner />
            </div>
          )}
        </section>
      )}

      {sent && sent !== "own" && (
        <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">✅ Review copied!</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>On Google, tap the stars you want to give.</li>
            <li>Long-press the text box and tap <b>Paste</b>.</li>
            <li>Change anything you like, then tap <b>Post</b>.</li>
          </ol>
        </div>
      )}

      <div className="space-y-2 border-t border-zinc-100 pt-4 text-center">
        {!result && (
          <button type="button" onClick={() => openGoogle("own")} className="text-sm font-medium text-zinc-600 hover:underline">
            Skip — I'll write my own on Google
          </button>
        )}
        <p className="text-xs leading-relaxed text-zinc-500">
          Reviews are optional and you get nothing extra for them. Please share your honest experience — you post it yourself on Google and can edit it first.
        </p>
      </div>
    </div>
  );
}
