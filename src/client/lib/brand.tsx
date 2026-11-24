import { cx } from "../components/ui";

/** Product name shown across the marketing site and auth screens. Change it here. */
export const BRAND = "Repeatly";
export const BRAND_TAGLINE = "Loyalty cards, Google reviews & WhatsApp — for local shops";

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight", light ? "text-white" : "text-zinc-900", className)}>
      <span className="relative flex size-8 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
      </span>
      <span className="text-lg">{BRAND}</span>
    </span>
  );
}
