import { cx } from "./ui";
import { stampEmoji } from "../lib/loyalty-api";

interface Props {
  businessName: string;
  logoUrl?: string | null;
  programName: string;
  customerName?: string | null;
  stampIcon: string;
  stampsRequired: number;
  points: number;
  rewards?: { name: string; pointsRequired: number }[];
  compact?: boolean;
  className?: string;
}

export function LoyaltyCard({ businessName, logoUrl, programName, customerName, stampIcon, stampsRequired, points, rewards = [], compact, className }: Props) {
  const total = Math.max(1, stampsRequired);
  const filled = Math.min(points, total);
  const sorted = [...rewards].sort((a, b) => a.pointsRequired - b.pointsRequired);
  const ready = sorted.filter((r) => points >= r.pointsRequired);
  const next = sorted.find((r) => points < r.pointsRequired);
  const emoji = stampEmoji(stampIcon);
  const cols = total <= 5 ? total : total <= 10 ? 5 : total <= 12 ? 6 : 8;

  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-400 text-white shadow-lg",
        compact ? "p-4" : "p-5 sm:p-6",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-16 -left-8 size-44 rounded-full bg-white/5" />
      <div className="relative flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="size-10 rounded-xl bg-white object-cover ring-2 ring-white/40" />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/20 text-lg font-semibold">{businessName[0] ?? "?"}</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{businessName}</p>
          <p className="truncate text-xs text-white/80">{programName}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums leading-none">{points}</p>
          <p className="text-[11px] text-white/80">of {total}</p>
        </div>
      </div>

      {!compact && (
        <div className="relative mt-5 grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: total }, (_, i) => (
            <div
              key={i}
              aria-hidden
              className={cx(
                "flex aspect-square items-center justify-center rounded-full text-lg transition",
                i < filled ? "bg-white shadow-sm" : "border-2 border-dashed border-white/40",
              )}
            >
              {i < filled ? emoji : <span className="text-xs text-white/50">{i + 1}</span>}
            </div>
          ))}
        </div>
      )}
      {compact && (
        <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-white/25">
          <div className="h-full rounded-full bg-white" style={{ width: `${(filled / total) * 100}%` }} />
        </div>
      )}

      <div className="relative mt-4 flex flex-wrap items-end justify-between gap-2 text-sm">
        <span className="text-white/90">{customerName ?? ""}</span>
        {ready.length > 0 ? (
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-brand-700">🎉 {ready.at(-1)!.name} ready</span>
        ) : next ? (
          <span className="text-xs text-white/85">
            {next.pointsRequired - points} more for {next.name}
          </span>
        ) : null}
      </div>
      <p className="sr-only">
        {points} of {total} stamps collected
      </p>
    </div>
  );
}
