import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { KEYWORD_GROUP_LABELS, type KeywordGroup, type ReviewKeyword } from "../lib/review-api";
import { Button, cx } from "./ui";

export const MAX_REVIEW_KEYWORDS = 15;
const GROUP_ORDER: KeywordGroup[] = ["product", "service", "ambience", "location", "other"];
const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

export async function saveReviewKeywords(businessId: string, keywords: ReviewKeyword[]) {
  return api<{ keywords: ReviewKeyword[] }>(`/api/businesses/${businessId}/review-keywords`, {
    method: "PUT",
    body: { keywords: keywords.map((k) => ({ text: k.text, group: k.group, source: k.source ?? "owner" })) },
  });
}

/**
 * Owner picks review keywords: AI suggestions (from shop details + Google listing facts) plus their own.
 * `selected` is what gets saved; unselected suggestions stay visible so they can be added back.
 */
export function ReviewKeywordsEditor({
  businessId,
  selected,
  onChange,
  autoSuggest,
}: {
  businessId: string;
  selected: ReviewKeyword[];
  onChange: (keywords: ReviewKeyword[]) => void;
  autoSuggest?: boolean;
}) {
  const [suggested, setSuggested] = useState<ReviewKeyword[]>([]);
  const [source, setSource] = useState<"ai" | "template" | null>(null);
  const [usedGoogle, setUsedGoogle] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const started = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  async function suggest(selectAll: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ keywords: ReviewKeyword[]; source: "ai" | "template"; usedGoogleFacts?: boolean }>(
        `/api/businesses/${businessId}/review-keywords/suggest`,
        { method: "POST" },
      );
      const list = res.keywords.map((k) => ({ ...k, source: "ai" as const }));
      setSuggested(list);
      setSource(res.source);
      setUsedGoogle(!!res.usedGoogleFacts);
      // First run: pre-select the suggestions so the owner only removes what doesn't fit.
      if (selectAll && selectedRef.current.length === 0) onChange(list.slice(0, MAX_REVIEW_KEYWORDS));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load suggestions. Add your own keywords below.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoSuggest || started.current) return;
    started.current = true;
    void suggest(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggest]);

  const isOn = (k: ReviewKeyword) => selected.some((s) => norm(s.text) === norm(k.text));
  const all = [...selected];
  for (const k of suggested) if (!all.some((a) => norm(a.text) === norm(k.text))) all.push(k);
  const full = selected.length >= MAX_REVIEW_KEYWORDS;

  function toggle(k: ReviewKeyword) {
    if (isOn(k)) onChange(selected.filter((s) => norm(s.text) !== norm(k.text)));
    else if (!full) onChange([...selected, k]);
  }

  function addOwn(e: FormEvent) {
    e.preventDefault();
    const text = draft.replace(/\s+/g, " ").trim();
    if (text.length < 2 || text.length > 30) return setError("Keywords should be 2 to 30 characters.");
    setError(null);
    setDraft("");
    const existing = all.find((a) => norm(a.text) === norm(text));
    if (existing) {
      if (!isOn(existing) && !full) onChange([...selected, existing]);
      return;
    }
    if (full) return setError(`You can keep up to ${MAX_REVIEW_KEYWORDS} keywords. Remove one first.`);
    onChange([...selected, { text, group: "other", source: "owner" }]);
  }

  const own = all.filter((k) => k.source === "owner");
  const groups = GROUP_ORDER.map((g) => ({ g, items: all.filter((k) => k.source !== "owner" && k.group === g) })).filter((x) => x.items.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-600">
          {loading && !suggested.length
            ? "✨ AI is reading your shop details…"
            : source === "ai"
              ? `✨ Suggested by AI from your shop details${usedGoogle ? " and Google listing" : ""}. Tap to remove what doesn't fit.`
              : source === "template"
                ? "Ready-made ideas for your type of shop. Tap to remove what doesn't fit."
                : "Customers tap these to describe their visit."}
        </p>
        <span className={cx("text-xs font-medium", full ? "text-amber-600" : "text-zinc-500")}>
          {selected.length}/{MAX_REVIEW_KEYWORDS} selected
        </span>
      </div>

      {loading && !suggested.length ? (
        <div className="flex flex-wrap gap-2" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className="h-8 animate-pulse rounded-full bg-zinc-100" style={{ width: `${70 + ((i * 37) % 60)}px` }} />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ g, items }) => (
            <ChipRow key={g} label={KEYWORD_GROUP_LABELS[g]} items={items} isOn={isOn} full={full} onToggle={toggle} />
          ))}
          {own.length > 0 && <ChipRow label="Your keywords" items={own} isOn={isOn} full={full} onToggle={toggle} />}
        </div>
      )}

      <form onSubmit={addOwn} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={30}
          placeholder="Add your own, e.g. Rajwadi chai"
          aria-label="Add your own keyword"
          className="h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
        />
        <Button type="submit" variant="secondary" disabled={!draft.trim()}>
          Add
        </Button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={() => suggest(false)} disabled={loading} className="text-sm font-medium text-brand-600 hover:underline disabled:opacity-50">
        {loading ? "Thinking…" : "↻ Suggest more with AI"}
      </button>
    </div>
  );
}

function ChipRow({
  label,
  items,
  isOn,
  full,
  onToggle,
}: {
  label: string;
  items: ReviewKeyword[];
  isOn: (k: ReviewKeyword) => boolean;
  full: boolean;
  onToggle: (k: ReviewKeyword) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((k) => {
          const on = isOn(k);
          return (
            <button
              key={k.text}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => onToggle(k)}
              className={cx(
                "rounded-full border px-3 py-1.5 text-sm transition",
                on ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-dashed border-zinc-300 bg-white text-zinc-500 hover:border-brand-400",
                !on && full && "opacity-40",
              )}
            >
              {on ? "✓ " : "+ "}
              {k.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
