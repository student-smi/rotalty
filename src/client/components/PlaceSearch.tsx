import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import type { BusinessCategory } from "../../shared/permissions";
import { cx } from "./ui";

export interface PlaceDetails {
  placeId: string;
  name: string;
  category: BusinessCategory;
  categoryLabel: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUri: string | null;
  reviewUrl: string;
  rating: number | null;
  userRatingCount: number | null;
}

interface Suggestion {
  placeId: string;
  name: string;
  secondary: string;
}

/** True when the server has a Google Places key. The search box hides itself otherwise. */
export function usePlacesEnabled() {
  const q = useQuery({
    queryKey: ["places-status"],
    queryFn: () => api<{ enabled: boolean }>("/api/places/status"),
    staleTime: Infinity,
  });
  return !!q.data?.enabled;
}

const newSession = () => crypto.randomUUID();

/**
 * Google shop search (Places API New, proxied by our Worker).
 * One session token covers the typing + the final details call, which Google bills as a single session.
 */
export function PlaceSearch({
  onPick,
  label = "Find your shop on Google",
  placeholder = "Type your shop name and area, e.g. Sharma Chai Navrangpura",
  autoFocus,
}: {
  onPick: (place: PlaceDetails) => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const enabled = usePlacesEnabled();
  const id = useId();
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const session = useRef(newSession());
  const latest = useRef(0);
  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const text = q.trim();
    if (text.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    const ticket = ++latest.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await api<{ suggestions: Suggestion[] }>(
          `/api/places/autocomplete?${new URLSearchParams({ q: text, session: session.current })}`,
        );
        if (ticket !== latest.current) return;
        setSuggestions(res.suggestions);
        setActive(res.suggestions.length ? 0 : -1);
        setOpen(true);
        setError(null);
      } catch (err) {
        if (ticket !== latest.current) return;
        setSuggestions([]);
        setError(err instanceof ApiError ? err.message : "Search failed. Please try again.");
      } finally {
        if (ticket === latest.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  async function pick(s: Suggestion) {
    setPicking(s.placeId);
    setError(null);
    try {
      const { place } = await api<{ place: PlaceDetails }>(
        `/api/places/details/${encodeURIComponent(s.placeId)}?${new URLSearchParams({ session: session.current })}`,
      );
      session.current = newSession(); // the session ends with a details call
      if (place.name !== q) {
        skipNext.current = true;
        setQ(place.name);
      }
      setOpen(false);
      setSuggestions([]);
      onPick(place);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this place. Please try again.");
    } finally {
      setPicking(null);
    }
  }

  if (!enabled) return null;

  const listId = `${id}-list`;
  const showList = open && q.trim().length >= 3 && !searching;

  return (
    <div className="relative">
      <label htmlFor={`${id}-input`} className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-zinc-800">
        <svg viewBox="0 0 20 20" className="size-4 text-brand-600" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="m9.69 18.93.01.01a.75.75 0 0 0 .6 0l.01-.01.02-.01a12.4 12.4 0 0 0 1.24-.85 17.6 17.6 0 0 0 2.6-2.47C15.9 13.66 17.5 11.13 17.5 8a7.5 7.5 0 0 0-15 0c0 3.13 1.6 5.66 3.33 7.6a17.6 17.6 0 0 0 3.84 3.32ZM10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
        </svg>
        {label}
      </label>
      <div className="relative">
        <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 size-4.5 -translate-y-1/2 text-zinc-400" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z" clipRule="evenodd" />
        </svg>
        <input
          id={`${id}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          value={q}
          placeholder={placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => suggestions.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!showList || !suggestions.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % suggestions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              void pick(suggestions[active]!);
            } else if (e.key === "Escape") setOpen(false);
          }}
          className="h-12 w-full rounded-xl border border-zinc-300 bg-white pl-10 pr-10 text-[15px] shadow-sm outline-none transition placeholder:text-zinc-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
        />
        {(searching || picking) && (
          <span className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-500" aria-label="Loading" />
        )}
      </div>
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}

      {showList && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
          {suggestions.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-500">No shops found. Try adding your area or city, or fill in the details below.</p>
          ) : (
            <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
              {suggestions.map((s, i) => (
                <li
                  key={s.placeId}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void pick(s)}
                  className={cx("flex cursor-pointer items-start gap-3 px-4 py-2.5", i === active && "bg-brand-50")}
                >
                  <svg viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-zinc-400" fill="currentColor" aria-hidden>
                    <path fillRule="evenodd" d="m9.69 18.93.01.01a.75.75 0 0 0 .6 0l.01-.01.02-.01a12.4 12.4 0 0 0 1.24-.85 17.6 17.6 0 0 0 2.6-2.47C15.9 13.66 17.5 11.13 17.5 8a7.5 7.5 0 0 0-15 0c0 3.13 1.6 5.66 3.33 7.6a17.6 17.6 0 0 0 3.84 3.32ZM10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
                  </svg>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-900">{s.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{s.secondary}</span>
                  </span>
                  {picking === s.placeId && <span className="ml-auto mt-1 size-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-brand-500" />}
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-zinc-100 px-4 py-1.5 text-right text-[11px] text-zinc-400">Results from Google Maps</p>
        </div>
      )}
    </div>
  );
}

/** Compact confirmation of the picked listing. */
export function PlaceFoundCard({ place, onClear }: { place: PlaceDetails; onClear: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm text-white">✓</span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium text-emerald-900">Found on Google: {place.name}</p>
        <p className="truncate text-emerald-800/80">{[place.addressLine, place.city].filter(Boolean).join(", ")}</p>
        {place.rating != null && (
          <p className="mt-0.5 text-xs text-emerald-800/80">
            ⭐ {place.rating.toFixed(1)} · {place.userRatingCount?.toLocaleString("en-IN") ?? 0} Google reviews
          </p>
        )}
        <p className="mt-1 text-xs text-emerald-800/80">We filled in the details below. Please check them.</p>
      </div>
      <button type="button" onClick={onClear} className="shrink-0 text-xs font-medium text-emerald-800 hover:underline">
        Not my shop
      </button>
    </div>
  );
}
