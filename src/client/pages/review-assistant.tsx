import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../lib/api";
import { captchaHeaders, TURNSTILE_SITE_KEY } from "../lib/auth";
import { reviewFetch, type DraftStyle, type DraftsResponse, type PublicReviewInfo } from "../lib/review-api";
import { REVIEW_LANGUAGE_LABELS, type ReviewLanguage } from "../../shared/domain";
import { Alert, Button, PageLoader, Spinner } from "../components/ui";
import { Turnstile } from "../components/Turnstile";
import { QuickReview } from "../components/QuickReview";

type AnswerKey = "purchased" | "overall" | "service" | "liked" | "extra";

interface Copy {
  title: string;
  intro: string;
  questions: Record<AnswerKey, string>;
  required: string;
  generate: string;
  regenerate: string;
  styles: Record<DraftStyle, string>;
  copy: string;
  copied: string;
  continue: string;
  writeOwn: string;
  hint: string;
  disclaimer: string;
}

const COPY: Record<ReviewLanguage, Copy> = {
  en: {
    title: "Share your experience",
    intro: "Answer a few questions in your own words. We'll turn them into review drafts you can edit. Sharing a review is completely optional.",
    questions: {
      purchased: "What did you purchase?",
      overall: "How was your overall experience?",
      service: "How was the service?",
      liked: "What did you particularly like?",
      extra: "Anything else you'd like to mention?",
    },
    required: "required",
    generate: "Create review drafts",
    regenerate: "Try different drafts",
    styles: { short: "Short & simple", friendly: "Natural & friendly", detailed: "Detailed" },
    copy: "Copy",
    copied: "Copied!",
    continue: "Continue to Google Reviews",
    writeOwn: "Skip and write my own review on Google",
    hint: "Copy a draft first, then paste it on Google. You can change anything before posting.",
    disclaimer: "These are drafts based only on your answers. Edit them freely. Nothing is posted for you. You choose whether to post on Google yourself.",
  },
  hi: {
    title: "अपना अनुभव साझा करें",
    intro: "कुछ सवालों के जवाब अपने शब्दों में दें। हम उनसे समीक्षा के ड्राफ्ट बनाएंगे जिन्हें आप बदल सकते हैं। समीक्षा देना पूरी तरह वैकल्पिक है।",
    questions: {
      purchased: "आपने क्या खरीदा?",
      overall: "आपका कुल अनुभव कैसा रहा?",
      service: "सेवा कैसी थी?",
      liked: "आपको खास तौर पर क्या पसंद आया?",
      extra: "कुछ और बताना चाहेंगे?",
    },
    required: "ज़रूरी",
    generate: "समीक्षा ड्राफ्ट बनाएं",
    regenerate: "दूसरे ड्राफ्ट देखें",
    styles: { short: "छोटा और सरल", friendly: "सहज और दोस्ताना", detailed: "विस्तृत" },
    copy: "कॉपी करें",
    copied: "कॉपी हो गया!",
    continue: "Google Reviews पर जाएं",
    writeOwn: "छोड़ें और Google पर खुद लिखें",
    hint: "पहले ड्राफ्ट कॉपी करें, फिर Google पर पेस्ट करें। पोस्ट करने से पहले आप कुछ भी बदल सकते हैं।",
    disclaimer: "ये ड्राफ्ट सिर्फ आपके जवाबों पर आधारित हैं। इन्हें बदलें। आपकी ओर से कुछ भी पोस्ट नहीं होता। Google पर पोस्ट करना आपकी मर्ज़ी है।",
  },
  gu: {
    title: "તમારો અનુભવ શેર કરો",
    intro: "થોડા પ્રશ્નોના જવાબ તમારા શબ્દોમાં આપો. અમે તેમાંથી રિવ્યૂના ડ્રાફ્ટ બનાવીશું જે તમે બદલી શકો. રિવ્યૂ આપવો સંપૂર્ણપણે વૈકલ્પિક છે.",
    questions: {
      purchased: "તમે શું ખરીદ્યું?",
      overall: "તમારો એકંદર અનુભવ કેવો રહ્યો?",
      service: "સેવા કેવી હતી?",
      liked: "તમને ખાસ શું ગમ્યું?",
      extra: "બીજું કંઈ કહેવું છે?",
    },
    required: "જરૂરી",
    generate: "રિવ્યૂ ડ્રાફ્ટ બનાવો",
    regenerate: "બીજા ડ્રાફ્ટ જુઓ",
    styles: { short: "ટૂંકો અને સરળ", friendly: "સહજ અને મૈત્રીપૂર્ણ", detailed: "વિગતવાર" },
    copy: "કૉપિ કરો",
    copied: "કૉપિ થયું!",
    continue: "Google Reviews પર જાઓ",
    writeOwn: "છોડો અને Google પર જાતે લખો",
    hint: "પહેલા ડ્રાફ્ટ કૉપિ કરો, પછી Google પર પેસ્ટ કરો. પોસ્ટ કરતા પહેલા તમે કંઈ પણ બદલી શકો.",
    disclaimer: "આ ડ્રાફ્ટ ફક્ત તમારા જવાબો પર આધારિત છે. તેને બદલો. તમારા વતી કંઈ પોસ્ટ થતું નથી. Google પર પોસ્ટ કરવું તમારી મરજી છે.",
  },
  hinglish: {
    title: "Apna experience share karein",
    intro: "Kuch sawaalon ke jawaab apne shabdon mein dein. Hum unse review drafts banayenge jo aap edit kar sakte hain. Review dena bilkul optional hai.",
    questions: {
      purchased: "Aapne kya kharida?",
      overall: "Aapka overall experience kaisa raha?",
      service: "Service kaisi thi?",
      liked: "Aapko khaas kya pasand aaya?",
      extra: "Kuch aur batana chahenge?",
    },
    required: "zaroori",
    generate: "Review drafts banayein",
    regenerate: "Doosre drafts dekhein",
    styles: { short: "Short & simple", friendly: "Natural & friendly", detailed: "Detailed" },
    copy: "Copy",
    copied: "Copy ho gaya!",
    continue: "Google Reviews par jaayein",
    writeOwn: "Skip karke Google par khud likhein",
    hint: "Pehle draft copy karein, phir Google par paste karein. Post karne se pehle aap kuch bhi badal sakte hain.",
    disclaimer: "Ye drafts sirf aapke jawaabon par based hain. Inhe edit karein. Aapki taraf se kuch post nahi hota. Google par post karna aapki marzi hai.",
  },
};

const FIELDS: AnswerKey[] = ["purchased", "overall", "service", "liked", "extra"];
const REQUIRED: AnswerKey[] = ["purchased", "overall"];
const emptyAnswers: Record<AnswerKey, string> = { purchased: "", overall: "", service: "", liked: "", extra: "" };

export function ReviewAssistantPage() {
  const { slug = "" } = useParams();
  const info = useQuery({
    queryKey: ["public-review", slug],
    queryFn: () => reviewFetch<PublicReviewInfo>(`/api/public/review/${encodeURIComponent(slug)}`),
    retry: false,
    staleTime: Infinity,
  });

  if (info.isLoading) return <PageLoader />;
  if (info.error || !info.data) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold">This page isn't available</h1>
          <p className="mt-2 text-sm text-zinc-500">The business hasn't turned on reviews here, or the link is incorrect.</p>
          <Link to={`/s/${slug}`} className="mt-4 inline-block text-sm font-medium text-brand-600">Back to the business page</Link>
        </div>
      </div>
    );
  }
  // Owners who set up review keywords get the quick tap-to-pick flow; others keep the question form.
  if (info.data.keywords?.length) return <QuickReviewPage slug={slug} info={info.data} />;
  return <Assistant slug={slug} info={info.data} />;
}

function QuickReviewPage({ slug, info }: { slug: string; info: PublicReviewInfo }) {
  useEffect(() => {
    document.title = `Review ${info.business.name}`;
  }, [info.business.name]);
  return (
    <div className="min-h-dvh bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-4">
          {info.business.logoUrl ? (
            <img src={info.business.logoUrl} alt="" className="size-11 rounded-xl border border-zinc-200 object-cover" />
          ) : (
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand-500 text-lg font-semibold text-white">{info.business.name[0]}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{info.profileName}</p>
            <p className="text-sm text-zinc-500">Share your experience on Google</p>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <QuickReview slug={slug} info={info} />
        </div>
        <p className="py-6 text-center text-sm">
          <Link to={`/s/${slug}`} className="text-brand-600 hover:underline">← {info.business.name}</Link>
        </p>
      </main>
    </div>
  );
}

function Assistant({ slug, info }: { slug: string; info: PublicReviewInfo }) {
  const [lang, setLang] = useState<ReviewLanguage>(info.languages[0] ?? "en");
  const t = COPY[lang];
  const [answers, setAnswers] = useState(emptyAnswers);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const onToken = useCallback((tok: string | null) => setCaptcha(tok), []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [result, setResult] = useState<DraftsResponse | null>(null);
  const [texts, setTexts] = useState<Record<DraftStyle, string> | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    document.title = `${t.title} · ${info.business.name}`;
  }, [t.title, info.business.name]);

  async function generate(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await reviewFetch<DraftsResponse>(`/api/public/review/${encodeURIComponent(slug)}/drafts`, {
        body: { language: lang, answers, sessionId: result?.sessionId },
        headers: captchaHeaders(captcha),
      });
      setResult(res);
      setTexts(Object.fromEntries(res.drafts.map((d) => [d.style, d.text])) as Record<DraftStyle, string>);
      requestAnimationFrame(() => document.getElementById("drafts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (err) {
      setError(err instanceof ApiError ? { code: err.code, message: err.message } : { code: "UNKNOWN", message: "Something went wrong" });
    } finally {
      setLoading(false);
    }
  }

  async function continueToGoogle() {
    // Open the tab synchronously so mobile browsers don't treat it as a blocked popup.
    const tab = window.open("about:blank", "_blank");
    setRedirecting(true);
    try {
      const path = result
        ? `/api/public/review/sessions/${result.sessionId}/redirect`
        : `/api/public/review/${encodeURIComponent(slug)}/redirect`;
      const { url } = await reviewFetch<{ url: string }>(path, { method: "POST" });
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
      setError({ code: "REDIRECT", message: "Couldn't open Google Reviews. Please try again." });
    } finally {
      setRedirecting(false);
    }
  }

  const canGenerate = REQUIRED.every((k) => answers[k].trim()) && (!TURNSTILE_SITE_KEY || !!captcha);
  const fallbackError = error && ["AI_UNAVAILABLE", "AI_RATE_LIMITED", "AI_ERROR", "AI_INVALID_RESPONSE", "PLAN_LIMIT_REACHED", "REGENERATE_LIMIT"].includes(error.code);

  return (
    <div className="min-h-dvh bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-4">
          {info.business.logoUrl ? (
            <img src={info.business.logoUrl} alt="" className="size-11 rounded-xl border border-zinc-200 object-cover" />
          ) : (
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand-500 text-lg font-semibold text-white">{info.business.name[0]}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{info.profileName}</p>
            <p className="text-sm text-zinc-500">{t.title}</p>
          </div>
          {info.languages.length > 1 && (
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as ReviewLanguage)}
              aria-label="Language"
              className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm"
            >
              {info.languages.map((l) => (
                <option key={l} value={l}>{REVIEW_LANGUAGE_LABELS[l]}</option>
              ))}
            </select>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-xl space-y-5 px-4 py-6">
        <p className="text-sm text-zinc-600">{t.intro}</p>

        <form onSubmit={generate} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          {FIELDS.map((k) => (
            <div key={k} className="space-y-1.5">
              <label htmlFor={`q-${k}`} className="block text-sm font-medium text-zinc-800">
                {t.questions[k]} {REQUIRED.includes(k) && <span className="text-xs font-normal text-zinc-400">({t.required})</span>}
              </label>
              <textarea
                id={`q-${k}`}
                rows={k === "purchased" ? 1 : 2}
                maxLength={500}
                value={answers[k]}
                onChange={(e) => setAnswers({ ...answers, [k]: e.target.value })}
                className="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>
          ))}
          {!result && <Turnstile onToken={onToken} />}
          <Button type="submit" className="w-full" loading={loading} disabled={!canGenerate || (result?.generationsLeft ?? 1) <= 0}>
            {result ? t.regenerate : t.generate}
          </Button>
        </form>

        {error && (
          <Alert tone={fallbackError ? "warning" : "error"}>
            <p>{error.message}</p>
            {fallbackError && (
              <button onClick={continueToGoogle} className="mt-2 font-medium underline">{t.writeOwn}</button>
            )}
          </Alert>
        )}

        {result && texts && (
          <section id="drafts" className="space-y-4 scroll-mt-4">
            {result.drafts.map((d) => (
              <DraftCard
                key={d.style}
                label={t.styles[d.style]}
                value={texts[d.style]}
                onChange={(v) => setTexts({ ...texts, [d.style]: v })}
                copyLabel={t.copy}
                copiedLabel={t.copied}
              />
            ))}
            {loading && <div className="flex justify-center text-zinc-400"><Spinner /></div>}
          </section>
        )}

        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          {result && <p className="text-sm text-zinc-600">{t.hint}</p>}
          <Button className="w-full" variant={result ? "primary" : "secondary"} onClick={continueToGoogle} loading={redirecting}>
            {result ? t.continue : t.writeOwn}
          </Button>
          <p className="text-xs leading-relaxed text-zinc-500">{t.disclaimer}</p>
        </div>

        <p className="pb-6 text-center text-sm">
          <Link to={`/s/${slug}`} className="text-brand-600 hover:underline">← {info.business.name}</Link>
        </p>
      </main>
    </div>
  );
}

function DraftCard({ label, value, onChange, copyLabel, copiedLabel }: { label: string; value: string; onChange: (v: string) => void; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-800">{label}</p>
        <Button size="sm" variant={copied ? "secondary" : "primary"} onClick={copy}>
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(8, Math.max(3, Math.ceil(value.length / 45)))}
        className="block w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm leading-relaxed focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      />
    </div>
  );
}
