import type { ReactNode } from "react";
import { formatDate, stampEmoji } from "../lib/loyalty-api";
import type { ShopLinks } from "../../shared/shop-links";

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

const LINK_META: { kind: keyof ShopLinks; label: string; bg: string; icon: ReactNode }[] = [
  {
    kind: "whatsapp",
    label: "WhatsApp",
    bg: "bg-[#25D366]",
    icon: <path d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.4 5 5.1-1.3A9.9 9.9 0 1 0 12.04 2Zm4.5 12c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4 5.2 5.2 0 0 0 3.2.7 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" fill="currentColor" />,
  },
  {
    kind: "instagram",
    label: "Instagram",
    bg: "bg-gradient-to-tr from-amber-400 via-pink-500 to-purple-600",
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" />
      </g>
    ),
  },
  {
    kind: "directions",
    label: "Directions",
    bg: "bg-sky-500",
    icon: <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" fill="currentColor" />,
  },
  {
    kind: "call",
    label: "Call",
    bg: "bg-emerald-600",
    icon: <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1Z" fill="currentColor" />,
  },
  {
    kind: "website",
    label: "Website",
    bg: "bg-zinc-700",
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </g>
    ),
  },
];

/** Round contact buttons (WhatsApp, Instagram, Directions, Call, Website). Only filled-in ones show. */
export function ShopContactRow({
  name,
  links,
  slug,
  preview,
  compact,
}: {
  name: string;
  links: ShopLinks;
  slug?: string;
  preview?: boolean;
  /** Small icon row for the "My cards" list. */
  compact?: boolean;
}) {
  const items = LINK_META.filter((m) => links[m.kind]);
  if (!items.length) return null;
  const track = (kind: string) => {
    if (!slug || preview) return;
    void fetch(`/api/public/b/${encodeURIComponent(slug)}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  };
  if (compact) {
    return (
      <ul className="flex flex-wrap items-center gap-2" aria-label={`Contact ${name}`}>
        {items.map((m) => (
          <li key={m.kind}>
            <a
              href={links[m.kind]!}
              target={m.kind === "call" ? undefined : "_blank"}
              rel="noopener noreferrer"
              onClick={() => track(m.kind)}
              aria-label={`${m.label}: ${name}`}
              title={m.label}
              className={`flex size-9 items-center justify-center rounded-full text-white shadow-sm transition hover:scale-105 ${m.bg}`}
            >
              <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
                {m.icon}
              </svg>
            </a>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className="mt-6 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100" aria-label={`Contact ${name}`}>
      <p className="mb-3 text-center text-sm font-semibold text-zinc-800">Connect with {name}</p>
      <ul className="flex flex-wrap justify-center gap-4">
        {items.map((m) => (
          <li key={m.kind}>
            <a
              href={links[m.kind]!}
              target={m.kind === "call" ? undefined : "_blank"}
              rel="noopener noreferrer"
              onClick={(e) => {
                if (preview) e.preventDefault();
                track(m.kind);
              }}
              className="flex w-16 flex-col items-center gap-1.5 text-xs font-medium text-zinc-700"
            >
              <span className={`flex size-12 items-center justify-center rounded-full text-white shadow-sm ${m.bg}`}>
                <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
                  {m.icon}
                </svg>
              </span>
              {m.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
