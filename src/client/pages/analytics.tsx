import { useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { formatMonth, formatShortDate, num } from "../lib/billing-format";
import { Alert, Badge, Button, Card, cx, EmptyState, PageHeader, PageLoader } from "../components/ui";
import { BarChart, BreakdownBars, StatTile } from "../components/analytics-charts";
import { useBusinessContext } from "./business";

interface Overview {
  days: number;
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  totalVisits: number;
  pointsIssued: number;
  rewardsUnlocked: number;
  rewardsRedeemed: number;
  retentionRate: number;
  daily: { date: string; visits: number }[];
  weekly: { weekStart: string; visits: number }[];
  monthly: { month: string; visits: number }[];
  advancedAvailable: boolean;
  advanced: null | {
    programs: { id: string; name: string; status: string; cards: number; visits: number; redemptions: number }[];
    channels: Record<"qr" | "nfc_tag" | "nfc_phone" | "manual", number>;
    qrScans: number;
    nfcTagTaps: number;
    nfcRequests: number;
    failedTransactions: number;
    failuresByReason: { reason: string; count: number }[];
    duplicateAttempts: number;
    deviceCompatibilityFailures: number;
    customerTrend: { weekStart: string; newCustomers: number; returningCustomers: number }[];
  };
}

const RANGES = [7, 30, 90] as const;

const CHANNEL_LABELS: Record<string, string> = { qr: "QR scan", nfc_tag: "NFC tag", nfc_phone: "Phone NFC", manual: "Staff lookup" };

const REASON_LABELS: Record<string, string> = {
  DUPLICATE: "Duplicate scan",
  DAILY_LIMIT: "Daily limit reached",
  COOLDOWN: "Cooldown not over",
  TOKEN_EXPIRED: "Expired card QR",
  TOKEN_INVALID: "Invalid QR",
  TOKEN_BAD_SIGNATURE: "Invalid QR",
  TOKEN_MALFORMED: "Invalid QR",
  PROGRAM_INACTIVE: "Program inactive",
  CARD_NOT_FOUND: "Card not found",
  CARD_BLOCKED: "Card blocked",
  INSUFFICIENT_POINTS: "Not enough points",
  REWARD_NOT_FOUND: "Reward not found",
};

export function AnalyticsPage() {
  const { business, membership } = useBusinessContext();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const { data, error, isLoading, isFetching } = useQuery({
    queryKey: ["analytics", business.id, days],
    queryFn: () => api<Overview>(`/api/businesses/${business.id}/analytics/overview?days=${days}`),
    placeholderData: keepPreviousData,
  });
  const base = `/app/b/${business.id}`;
  const canBill = membership.permissions.includes("billing.manage");
  const canReviews = membership.permissions.includes("reviews.manage");
  const gated = data && !data.advancedAvailable;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="How customers come back, and which channels they use"
        actions={
          <div role="group" aria-label="Date range" className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm">
            {RANGES.map((r) => {
              const locked = r === 90 && gated;
              return (
                <button
                  key={r}
                  onClick={() => !locked && setDays(r)}
                  disabled={locked}
                  aria-pressed={days === r}
                  title={locked ? "90-day history needs a plan with advanced analytics" : undefined}
                  className={cx(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    days === r ? "bg-brand-500 text-white" : "text-zinc-600 hover:bg-zinc-100",
                    locked && "cursor-not-allowed opacity-50",
                  )}
                >
                  {r} days{locked ? " 🔒" : ""}
                </button>
              );
            })}
          </div>
        }
      />

      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <Alert>{error instanceof ApiError ? error.message : "Could not load analytics."}</Alert>
      ) : (
        <div className={cx("space-y-6 transition-opacity", isFetching && "opacity-70")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Total customers" value={num(data.totalCustomers)} hint={`${num(data.newCustomers)} new in ${data.days} days`} />
            <StatTile label="Visits" value={num(data.totalVisits)} hint={`${num(data.pointsIssued)} points issued`} />
            <StatTile label="Returning customers" value={num(data.returningCustomers)} hint="Visited in range, 2+ visits ever" />
            <StatTile label="Retention rate" value={`${data.retentionRate}%`} hint="Customers with 2+ visits" tone="brand" />
            <StatTile label="Rewards unlocked" value={num(data.rewardsUnlocked)} />
            <StatTile label="Rewards redeemed" value={num(data.rewardsRedeemed)} />
            <StatTile label="New customers" value={num(data.newCustomers)} />
            <StatTile
              label="Avg. visits / day"
              value={(data.totalVisits / data.days).toFixed(1)}
              hint={`Over the last ${data.days} days`}
            />
          </div>

          <Card title="Daily visits" description="Points collected per day (India time)">
            {data.totalVisits === 0 ? (
              <EmptyState title="No visits yet in this period" description="Visits appear here as soon as staff issue points by QR, NFC or phone lookup." />
            ) : (
              <BarChart
                ariaLabel={`Daily visits over the last ${data.days} days, total ${data.totalVisits}`}
                data={data.daily.map((d) => ({ label: formatShortDate(d.date), value: d.visits, title: `${formatShortDate(d.date)}: ${d.visits} visits` }))}
              />
            )}
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card title="Weekly visits">
              <SummaryList rows={data.weekly.map((w) => ({ label: `Week of ${formatShortDate(w.weekStart)}`, value: w.visits }))} />
            </Card>
            <Card title="Monthly visits">
              <SummaryList rows={data.monthly.map((m) => ({ label: formatMonth(m.month), value: m.visits }))} />
            </Card>
          </div>

          {data.advanced ? (
            <AdvancedSections a={data.advanced} />
          ) : (
            <Card>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Unlock advanced analytics</p>
                  <p className="mt-0.5 text-sm text-zinc-500">
                    Program performance, QR vs NFC breakdown, failed and duplicate scans, device compatibility and 90-day history.
                  </p>
                </div>
                {canBill ? (
                  <Link to={`${base}/subscription`}>
                    <Button>See plans</Button>
                  </Link>
                ) : (
                  <Badge>Ask the owner to upgrade</Badge>
                )}
              </div>
            </Card>
          )}

          {canReviews && (
            <p className="text-sm text-zinc-500">
              Looking for review numbers?{" "}
              <Link to={`${base}/reviews`} className="font-medium text-brand-600 hover:underline">
                See AI Review Assistant analytics
              </Link>
              . Redirect clicks show customers who opened Google, not published reviews.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function SummaryList({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <ul className="divide-y divide-zinc-100 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="flex justify-between py-2">
          <span className="text-zinc-600">{r.label}</span>
          <span className="font-medium tabular-nums">{num(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function AdvancedSections({ a }: { a: NonNullable<Overview["advanced"]> }) {
  const channelItems = Object.entries(a.channels).map(([k, v]) => ({ label: CHANNEL_LABELS[k] ?? k, value: v }));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="QR page scans" value={num(a.qrScans)} hint="Printed QR codes opened" />
        <StatTile label="NFC tag taps" value={num(a.nfcTagTaps)} hint={`${num(a.nfcRequests)} collection requests`} />
        <StatTile label="Failed attempts" value={num(a.failedTransactions)} hint={`${num(a.duplicateAttempts)} duplicates blocked`} />
        <StatTile label="Unsupported devices" value={num(a.deviceCompatibilityFailures)} hint="Fell back to QR" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="How points were collected">
          <BreakdownBars items={channelItems} emptyText="No points collected in this period" />
        </Card>
        <Card title="Why attempts failed" description="Blocked scans protect you from abuse">
          <BreakdownBars
            items={a.failuresByReason.map((f) => ({ label: REASON_LABELS[f.reason] ?? f.reason, value: f.count }))}
            emptyText="No failed attempts — nice."
          />
        </Card>
      </div>

      <Card title="Loyalty program performance">
        {a.programs.length === 0 ? (
          <EmptyState title="No programs yet" />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Program</th>
                  <th className="px-5 py-2 text-right font-medium">Cards</th>
                  <th className="px-5 py-2 text-right font-medium">Visits</th>
                  <th className="px-5 py-2 text-right font-medium">Redemptions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {a.programs.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{p.name}</span>{" "}
                      {p.status !== "active" && <Badge>{p.status}</Badge>}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{num(p.cards)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{num(p.visits)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">{num(p.redemptions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Customer activity" description="Active customers per week: first-time vs returning">
        <ul className="space-y-3">
          {a.customerTrend.map((w) => {
            const total = w.newCustomers + w.returningCustomers;
            return (
              <li key={w.weekStart}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-zinc-600">Week of {formatShortDate(w.weekStart)}</span>
                  <span className="tabular-nums text-zinc-500">
                    {w.newCustomers} new · {w.returningCustomers} returning
                  </span>
                </div>
                <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
                  {total > 0 && (
                    <>
                      <div className="h-full bg-brand-500" style={{ width: `${(w.newCustomers / total) * 100}%` }} />
                      <div className="h-full bg-emerald-500" style={{ width: `${(w.returningCustomers / total) * 100}%` }} />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-brand-500" /> New</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" /> Returning</span>
        </p>
      </Card>
    </>
  );
}
