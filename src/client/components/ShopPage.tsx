import type { ReactNode } from "react";
import { formatDate, stampEmoji } from "../lib/loyalty-api";

/**
 * Pieces of the customer-facing shop page (/s/:slug). The real page and the dashboard previews both use
 * these, so what owners see while editing is exactly what customers get.
 */

export interface ShopInfo {
  name: string;
  logoUrl: string | null;
  addressLine?: string | null;
  city?: string | null;
  description?: string | null;
}

export function ShopHeader({ shop }: { shop: ShopInfo }) {
  const place = [shop.addressLine, shop.city].filter(Boolean).join(", ");
  return (
    <header>
      <div className="flex items-center gap-4">
        {shop.logoUrl ? (
          <img src={shop.logoUrl} alt="" className="size-16 shrink-0 rounded-2xl bg-white object-cover shadow-sm" />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-brand-500 text-2xl font-bold text-white shadow-sm">{shop.name[0] ?? "?"}</div>
        )}
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-bold tracking-tight">{shop.name || "Your shop name"}</h1>
          {place && <p className="truncate text-zinc-600">📍 {place}</p>}
        </div>
      </div>
      {shop.description && <p className="mt-3 text-[15px] leading-relaxed text-zinc-700">{shop.description}</p>}
    </header>
  );
}

export interface OfferProgram {
  name: string;
  description: string | null;
  stampIcon: string;
  stampsRequired: number;
  minPurchaseAmount: number | null;
  endsAt: string | null;
  eligibility: string | null;
  terms: string | null;
  rewards: { name: string; pointsRequired: number }[];
}

/** One loyalty offer on the shop page, with an action slot (join form or "Open my card"). */
export function ProgramOffer({ program, stamps = 0, action }: { program: OfferProgram; stamps?: number; action?: ReactNode }) {
  const p = program;
  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
      <div className="bg-gradient-to-br from-brand-600 to-indigo-400 p-5 text-white">
        <p className="text-sm text-white/80">Loyalty card</p>
        <h2 className="break-words text-xl font-semibold">{p.name || "Your card name"}</h2>
        {p.description && <p className="mt-1 text-white/90">{p.description}</p>}
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label={`${p.stampsRequired} stamps`}>
          {Array.from({ length: Math.min(p.stampsRequired, 20) }, (_, i) => (
            <span key={i} className="flex size-7 items-center justify-center rounded-full bg-white/20 text-sm">
              {i < stamps ? stampEmoji(p.stampIcon) : ""}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-4 p-5">
        <ul className="space-y-1.5">
          {[...p.rewards]
            .sort((a, b) => a.pointsRequired - b.pointsRequired)
            .map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{r.pointsRequired} stamps</span>
                <span className="font-medium">{r.name}</span>
              </li>
            ))}
        </ul>
        {(p.minPurchaseAmount || p.endsAt) && (
          <p className="text-xs text-zinc-500">
            {p.minPurchaseAmount ? `1 stamp per visit with a purchase of ₹${p.minPurchaseAmount} or more. ` : ""}
            {p.endsAt ? `Offer ends ${formatDate(p.endsAt)}.` : ""}
          </p>
        )}
        {(p.terms || p.eligibility) && (
          <details className="text-sm text-zinc-600">
            <summary className="cursor-pointer font-medium text-zinc-800">Terms & conditions</summary>
            {p.eligibility && <p className="mt-2 whitespace-pre-line">{p.eligibility}</p>}
            {p.terms && <p className="mt-2 whitespace-pre-line">{p.terms}</p>}
          </details>
        )}
        {action}
      </div>
    </article>
  );
}

/** First-time visitors see the whole journey before being asked for details. */
export function HowItWorksStrip() {
  const steps = [
    ["📝", "Join", "Name & mobile number"],
    ["📱", "Show card", "Staff scan it at billing"],
    ["🎁", "Get reward", "When your card is full"],
  ];
  return (
    <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="How it works">
      {steps.map(([icon, title, text], i) => (
        <li key={title} className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-zinc-100">
          <span className="text-2xl" aria-hidden>
            {icon}
          </span>
          <p className="mt-1 text-sm font-semibold">
            {i + 1}. {title}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-zinc-500">{text}</p>
        </li>
      ))}
    </ol>
  );
}

/** Non-interactive stand-in for the join button in previews. */
export function JoinButtonPreview() {
  return <div className="flex h-12 w-full items-center justify-center rounded-lg bg-brand-500 text-base font-medium text-white">Join — it's free</div>;
}
