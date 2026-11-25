import { useState, type FormEvent } from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { CATEGORY_LABELS } from "../lib/labels";
import { formatDateIN, formatDateTimeIN, formatINR, formatMonth, formatShortDate, formatUsdMicro, num } from "../lib/billing-format";
import { PLAN_LIMIT_LABELS, type PlanLimits } from "../../shared/domain";
import type { BusinessCategory } from "../../shared/permissions";
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner, Textarea } from "./ui";
import { BarChart, StatTile } from "./analytics-charts";

function Loading() {
  return (
    <div className="flex justify-center py-10 text-zinc-400">
      <Spinner />
    </div>
  );
}

function ErrorBox({ error }: { error: unknown }) {
  return <Alert>{error instanceof ApiError ? error.message : "Could not load this section."}</Alert>;
}

// ---------- Overview ----------

interface OverviewData {
  businesses: { active: number; suspended: number };
  users: number;
  customers: number;
  cards: number;
  transactionsToday: number;
  revenueThisMonthPaise: number;
  aiCostThisMonthMicroUsd: number;
  activePaidSubscriptions: { code: string; name: string; n: number }[];
}

export function OverviewPanel() {
  const { data, error, isLoading } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api<OverviewData>("/api/admin/overview") });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const paid = data.activePaidSubscriptions.reduce((s, p) => s + p.n, 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active businesses" value={num(data.businesses.active)} hint={`${num(data.businesses.suspended)} suspended`} />
        <StatTile label="Registered users" value={num(data.users)} />
        <StatTile label="Customers" value={num(data.customers)} hint={`${num(data.cards)} loyalty cards`} />
        <StatTile label="Transactions today" value={num(data.transactionsToday)} />
        <StatTile label="Revenue this month" value={formatINR(data.revenueThisMonthPaise)} tone="brand" />
        <StatTile label="Paid subscriptions" value={num(paid)} />
        <StatTile label="AI cost this month" value={formatUsdMicro(data.aiCostThisMonthMicroUsd)} hint="Estimated" />
      </div>
      <Card title="Active paid subscriptions by plan">
        {data.activePaidSubscriptions.length === 0 ? (
          <p className="text-sm text-zinc-500">No paid subscriptions yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {data.activePaidSubscriptions.map((p) => (
              <li key={p.code} className="flex justify-between py-2">
                <span>{p.name}</span>
                <span className="font-medium tabular-nums">{num(p.n)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Businesses ----------

interface AdminBusiness {
  id: string;
  name: string;
  category: BusinessCategory;
  city: string | null;
  status: "active" | "suspended";
  suspendedReason: string | null;
  createdAt: string;
  ownerEmail: string;
  ownerName: string;
  staffCount: number | null;
}

export function BusinessesPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const params = new URLSearchParams({ page: String(page), ...(q && { q }), ...(status && { status }) });
  const list = useQuery({
    queryKey: ["admin", "businesses", params.toString()],
    queryFn: () => api<{ businesses: AdminBusiness[]; hasMore: boolean }>(`/api/admin/businesses?${params}`),
    placeholderData: keepPreviousData,
  });
  const setBizStatus = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: "active" | "suspended"; reason?: string }) =>
      api(`/api/admin/businesses/${id}/status`, { method: "PATCH", body: { status, reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin"] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Update failed"),
  });

  return (
    <Card title="Businesses">
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input placeholder="Search name, owner email or city" aria-label="Search businesses" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="sm:max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-44">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : !list.data?.businesses.length ? (
        <EmptyState title="No businesses found" />
      ) : (
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-zinc-100 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-5 py-2 font-medium">Business</th>
                <th className="px-5 py-2 font-medium">Owner</th>
                <th className="px-5 py-2 font-medium">Staff</th>
                <th className="px-5 py-2 font-medium">Created</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {list.data.businesses.map((b) => (
                <tr key={b.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium">{b.name}</p>
                    <p className="text-xs text-zinc-500">{CATEGORY_LABELS[b.category] ?? b.category}{b.city ? ` · ${b.city}` : ""}</p>
                  </td>
                  <td className="px-5 py-3">
                    <p>{b.ownerName}</p>
                    <p className="text-xs text-zinc-500">{b.ownerEmail}</p>
                  </td>
                  <td className="px-5 py-3 tabular-nums">{b.staffCount ?? 0}</td>
                  <td className="px-5 py-3 text-zinc-500">{formatDateIN(b.createdAt)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={b.status === "active" ? "success" : "danger"}>{b.status}</Badge>
                    {b.suspendedReason && <p className="mt-1 max-w-[12rem] truncate text-xs text-zinc-500" title={b.suspendedReason}>{b.suspendedReason}</p>}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {b.status === "active" ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          const reason = prompt(`Reason for suspending "${b.name}"?`);
                          if (reason !== null) setBizStatus.mutate({ id: b.id, status: "suspended", reason: reason || undefined });
                        }}
                      >
                        Suspend
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setBizStatus.mutate({ id: b.id, status: "active" })}>Activate</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} hasMore={!!list.data?.hasMore} onPage={setPage} />
    </Card>
  );
}

function Pager({ page, hasMore, onPage }: { page: number; hasMore: boolean; onPage: (p: number) => void }) {
  return (
    <div className="mt-4 flex justify-between">
      <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <Button size="sm" variant="secondary" disabled={!hasMore} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

// ---------- Subscriptions ----------

interface AdminSubscription {
  userId: string;
  email: string;
  name: string;
  planCode: string;
  planName: string;
  status: "active" | "expired" | "cancelled";
  currentPeriodEnd: string | null;
}

interface AdminPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricePaise: number;
  intervalDays: number;
  isActive: boolean;
  limits: PlanLimits;
}

export function SubscriptionsPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [grant, setGrant] = useState<AdminSubscription | null>(null);
  const params = new URLSearchParams({ page: String(page), ...(q && { q }) });
  const list = useQuery({
    queryKey: ["admin", "subscriptions", params.toString()],
    queryFn: () => api<{ subscriptions: AdminSubscription[]; hasMore: boolean }>(`/api/admin/subscriptions?${params}`),
    placeholderData: keepPreviousData,
  });

  return (
    <Card title="Subscriptions" description="Accounts that have had a paid or granted plan. Everyone else is on Free.">
      <Input placeholder="Search email or name" aria-label="Search subscriptions" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="mb-4 sm:max-w-xs" />
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : !list.data?.subscriptions.length ? (
        <EmptyState title="No subscriptions yet" />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {list.data.subscriptions.map((s) => {
            const lapsed = s.status !== "active" || (s.currentPeriodEnd !== null && new Date(s.currentPeriodEnd).getTime() < Date.now());
            return (
              <li key={s.userId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.name}</p>
                  <p className="truncate text-xs text-zinc-500">{s.email}</p>
                </div>
                <div className="text-right">
                  <p>
                    {s.planName} <Badge tone={lapsed ? "danger" : "success"}>{lapsed ? "expired" : s.status}</Badge>
                  </p>
                  <p className="text-xs text-zinc-500">until {formatDateIN(s.currentPeriodEnd)}</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setGrant(s)}>Change</Button>
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={page} hasMore={!!list.data?.hasMore} onPage={setPage} />
      <Modal open={!!grant} onClose={() => setGrant(null)} title={grant ? `Grant plan to ${grant.email}` : ""}>
        {grant && (
          <GrantForm
            userId={grant.userId}
            defaultPlan={grant.planCode}
            onDone={() => {
              setGrant(null);
              qc.invalidateQueries({ queryKey: ["admin"] });
            }}
          />
        )}
      </Modal>
    </Card>
  );
}

function GrantForm({ userId, defaultPlan, onDone }: { userId: string; defaultPlan: string; onDone: () => void }) {
  const plans = useQuery({ queryKey: ["admin", "plans"], queryFn: () => api<{ plans: AdminPlan[] }>("/api/admin/plans") });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: { planCode: string; days: number }) => api(`/api/admin/subscriptions/${userId}`, { method: "PUT", body }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({ planCode: String(f.get("planCode")), days: Number(f.get("days")) });
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Select label="Plan" name="planCode" defaultValue={defaultPlan}>
        {plans.data?.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
      </Select>
      <Input label="Days from today" name="days" type="number" min={1} max={3660} defaultValue={30} required hint="Replaces the current period. Recorded in the audit log." />
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>Grant plan</Button>
      </div>
    </form>
  );
}

// ---------- Revenue ----------

interface RevenueData {
  months: { month: string; amountPaise: number; payments: number }[];
  byPlan: { code: string; name: string; amountPaise: number; payments: number }[];
  totalPaise: number;
}

export function RevenuePanel() {
  const { data, error, isLoading } = useQuery({ queryKey: ["admin", "revenue"], queryFn: () => api<RevenueData>("/api/admin/revenue") });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Last 12 months" value={formatINR(data.totalPaise)} tone="brand" />
        <StatTile label="This month" value={formatINR(data.months.at(-1)?.amountPaise ?? 0)} />
        <StatTile label="Payments (12 months)" value={num(data.months.reduce((s, m) => s + m.payments, 0))} />
      </div>
      <Card title="Monthly revenue" description="Paid Razorpay payments, India time">
        <BarChart
          ariaLabel={`Monthly revenue for the last 12 months, total ${formatINR(data.totalPaise)}`}
          formatValue={(v) => formatINR(v)}
          data={data.months.map((m) => ({ label: formatMonth(m.month), value: m.amountPaise, title: `${formatMonth(m.month)}: ${formatINR(m.amountPaise)} (${m.payments} payments)` }))}
        />
      </Card>
      <Card title="By plan">
        {data.byPlan.length === 0 ? (
          <p className="text-sm text-zinc-500">No revenue yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {data.byPlan.map((p) => (
              <li key={p.code} className="flex justify-between py-2">
                <span>{p.name} <span className="text-zinc-500">· {p.payments} payments</span></span>
                <span className="font-medium tabular-nums">{formatINR(p.amountPaise)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Plans ----------

const COUNT_KEYS: (keyof PlanLimits)[] = [
  "businesses",
  "locationsPerBusiness",
  "staffPerBusiness",
  "customersPerBusiness",
  "programsPerBusiness",
  "aiGenerationsPerMonth",
  "campaignMessagesPerMonth",
];
const BOOL_KEYS: (keyof PlanLimits)[] = ["nfc", "marketing", "advancedAnalytics"];

export function PlansPanel() {
  const { data, error, isLoading } = useQuery({ queryKey: ["admin", "plans"], queryFn: () => api<{ plans: AdminPlan[] }>("/api/admin/plans") });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-6">
      <Alert tone="info">Changes apply immediately to every account on the plan. Lowering a limit never deletes existing data; it only blocks new additions.</Alert>
      {data.plans.map((p) => <PlanEditor key={p.id} plan={p} />)}
    </div>
  );
}

function PlanEditor({ plan }: { plan: AdminPlan }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api(`/api/admin/plans/${plan.id}`, { method: "PUT", body }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin", "plans"] });
      qc.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (e) => {
      setSaved(false);
      setError(e instanceof ApiError ? e.message : "Could not save");
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const limits = {} as Record<string, number | boolean | null>;
    for (const k of COUNT_KEYS) {
      const raw = String(f.get(k) ?? "").trim();
      limits[k] = raw === "" ? null : Number(raw);
    }
    for (const k of BOOL_KEYS) limits[k] = f.get(k) === "on";
    save.mutate({
      name: String(f.get("name")).trim(),
      description: String(f.get("description")).trim() || null,
      pricePaise: Math.round(Number(f.get("priceRupees")) * 100),
      intervalDays: Number(f.get("intervalDays")),
      isActive: f.get("isActive") === "on",
      limits,
    });
  }

  const isFree = plan.code === "free";
  return (
    <Card title={plan.name} description={`Code: ${plan.code}`} actions={<Badge tone={plan.isActive ? "success" : "neutral"}>{plan.isActive ? "Active" : "Hidden"}</Badge>}>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {saved && <Alert tone="success">Saved</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Name" name="name" defaultValue={plan.name} required minLength={2} maxLength={60} />
          <Input label="Price (₹)" name="priceRupees" type="number" min={0} step="0.01" defaultValue={plan.pricePaise / 100} disabled={isFree} />
          <Input label="Period (days)" name="intervalDays" type="number" min={1} max={366} defaultValue={plan.intervalDays} required />
        </div>
        {isFree && <input type="hidden" name="priceRupees" value="0" />}
        <Textarea label="Description" name="description" defaultValue={plan.description ?? ""} maxLength={300} rows={2} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-zinc-700">Limits <span className="font-normal text-zinc-500">(leave empty for unlimited)</span></legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {COUNT_KEYS.map((k) => {
              const v = plan.limits[k] as number | null;
              return <Input key={k} label={PLAN_LIMIT_LABELS[k]} name={k} type="number" min={0} defaultValue={v ?? ""} placeholder="Unlimited" />;
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {BOOL_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm text-zinc-700">
                <input type="checkbox" name={k} defaultChecked={Boolean(plan.limits[k])} className="size-4 rounded border-zinc-300 accent-brand-500" />
                {PLAN_LIMIT_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="isActive" defaultChecked={plan.isActive} disabled={isFree} className="size-4 rounded border-zinc-300 accent-brand-500" />
            Available for purchase
            {isFree && <input type="hidden" name="isActive" value="on" />}
          </label>
          <Button type="submit" loading={save.isPending}>Save {plan.name}</Button>
        </div>
      </form>
    </Card>
  );
}

// ---------- AI usage ----------

interface AiUsageData {
  days: number;
  totals: { calls: number; errors: number; errorRate: number; inputTokens: number; outputTokens: number; costMicroUsd: number };
  byBusiness: { businessId: string | null; name: string | null; calls: number; cost: number; errors: number }[];
  daily: { day: string; calls: number; cost: number }[];
}

export function AiUsagePanel() {
  const [days, setDays] = useState(30);
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin", "ai", days],
    queryFn: () => api<AiUsageData>(`/api/admin/ai-usage?days=${days}`),
    placeholderData: keepPreviousData,
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="space-y-6">
      <Select aria-label="Range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-40">
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
      </Select>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="AI calls" value={num(data.totals.calls)} />
        <StatTile label="Error rate" value={`${data.totals.errorRate}%`} hint={`${num(data.totals.errors)} errors`} />
        <StatTile label="Tokens" value={num(data.totals.inputTokens + data.totals.outputTokens)} hint={`${num(data.totals.inputTokens)} in · ${num(data.totals.outputTokens)} out`} />
        <StatTile label="Estimated cost" value={formatUsdMicro(data.totals.costMicroUsd)} tone="brand" />
      </div>
      <Card title="Daily calls">
        {data.daily.length === 0 ? (
          <p className="text-sm text-zinc-500">No AI calls in this period.</p>
        ) : (
          <BarChart
            ariaLabel={`Daily AI calls, total ${data.totals.calls}`}
            data={data.daily.map((d) => ({ label: formatShortDate(d.day), value: d.calls, title: `${formatShortDate(d.day)}: ${d.calls} calls, ${formatUsdMicro(d.cost)}` }))}
          />
        )}
      </Card>
      <Card title="Top businesses">
        {data.byBusiness.length === 0 ? (
          <p className="text-sm text-zinc-500">No usage yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {data.byBusiness.map((b) => (
              <li key={b.businessId ?? "none"} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{b.name ?? "Platform"}</span>
                <span className="tabular-nums text-zinc-600">
                  {num(b.calls)} calls · {num(b.errors)} errors · {formatUsdMicro(b.cost)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------- Transactions ----------

interface AdminTx {
  id: string;
  type: "earn" | "redeem" | "adjust";
  points: number;
  channel: string;
  createdAt: string;
  businessId: string;
  businessName: string;
  customerName: string;
  programName: string;
  staffEmail: string | null;
}

export function TransactionsPanel() {
  const [type, setType] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["admin", "transactions", type],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api<{ transactions: AdminTx[]; nextBefore: number | null }>(
        `/api/admin/transactions?${new URLSearchParams({ ...(type && { type }), ...(pageParam && { before: String(pageParam) }) })}`,
      ),
    getNextPageParam: (last) => last.nextBefore,
  });
  const rows = list.data?.pages.flatMap((p) => p.transactions) ?? [];
  return (
    <Card title="Transactions" description="Every loyalty point issued or redeemed across the platform">
      <Select aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} className="mb-4 w-44">
        <option value="">All types</option>
        <option value="earn">Points issued</option>
        <option value="redeem">Redemptions</option>
      </Select>
      {list.isLoading ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : rows.length === 0 ? (
        <EmptyState title="No transactions yet" />
      ) : (
        <>
          <ul className="divide-y divide-zinc-100">
            {rows.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {t.customerName} <span className="font-normal text-zinc-500">at {t.businessName}</span>
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {t.programName} · {t.channel} · {t.staffEmail ?? "system"} · {formatDateTimeIN(t.createdAt)}
                  </p>
                </div>
                <Badge tone={t.points > 0 ? "success" : "warning"}>{t.points > 0 ? `+${t.points}` : t.points}</Badge>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="mt-4 text-center">
              <Button size="sm" variant="secondary" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ---------- Suspicious ----------

interface SuspiciousItem {
  kind: "staff_burst" | "card_failures" | "duplicate_spike" | "join_spree";
  severity: "high" | "medium" | "low";
  reason: string;
  businessId: string | null;
  businessName: string | null;
}

const KIND_LABELS: Record<SuspiciousItem["kind"], string> = {
  staff_burst: "Unusual point issuing",
  card_failures: "Repeated failed scans",
  duplicate_spike: "Duplicate scan spike",
  join_spree: "Many sign-ups",
};

export function SuspiciousPanel() {
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "suspicious"],
    queryFn: () => api<{ items: SuspiciousItem[] }>("/api/admin/suspicious"),
  });
  return (
    <Card
      title="Suspicious activity (last 24 hours)"
      description="Automatic heuristics. Review before acting: some may be legitimate busy periods."
      actions={<Button size="sm" variant="secondary" loading={isFetching} onClick={() => refetch()}>Refresh</Button>}
    >
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox error={error} />
      ) : data.items.length === 0 ? (
        <EmptyState title="Nothing suspicious" description="No staff bursts, failed-scan floods, duplicate spikes or sign-up sprees in the last 24 hours." />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data.items.map((i, idx) => (
            <li key={idx} className="flex flex-wrap items-start gap-3 py-3 text-sm">
              <Badge tone={i.severity === "high" ? "danger" : i.severity === "medium" ? "warning" : "neutral"}>{i.severity}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{KIND_LABELS[i.kind]}{i.businessName ? ` · ${i.businessName}` : ""}</p>
                <p className="text-zinc-600">{i.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- Settings ----------

export function SettingsPanel() {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: () =>
      api<{
        settings: {
          maintenanceMessage: string | null;
          signupsEnabled: boolean;
          upiId: string | null;
          upiPayeeName: string | null;
          paymentMethod: "contact" | "upi" | "razorpay";
          provisionalAccess: boolean;
        };
      }>("/api/admin/settings"),
  });
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/admin/settings", { method: "PUT", body }),
    onSuccess: () => {
      setNotice({ tone: "success", text: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (e) => setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "Could not save" }),
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      maintenanceMessage: String(f.get("maintenanceMessage")).trim() || null,
      signupsEnabled: f.get("signupsEnabled") === "on",
      upiId: String(f.get("upiId")).trim(),
      upiPayeeName: String(f.get("upiPayeeName")).trim() || null,
      paymentMethod: (["contact", "upi", "razorpay"] as const).find((m) => m === String(f.get("paymentMethod"))) ?? "contact",
      provisionalAccess: f.get("provisionalAccess") === "on",
    });
  }

  return (
    <Card title="Platform settings">
      <form onSubmit={onSubmit} className="space-y-4">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <Textarea
          label="Maintenance message"
          name="maintenanceMessage"
          maxLength={300}
          rows={2}
          defaultValue={data.settings.maintenanceMessage ?? ""}
          hint="Available to signed-in users via /api/billing/platform-status. Leave empty for none."
        />
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" name="signupsEnabled" defaultChecked={data.settings.signupsEnabled} className="size-4 rounded border-zinc-300 accent-brand-500" />
          Allow new business sign-ups
        </label>

        <fieldset className="space-y-4 rounded-xl border border-zinc-200 p-4">
          <legend className="px-1 text-sm font-semibold text-zinc-800">Plan payments</legend>
          <Select label="How owners pay" name="paymentMethod" defaultValue={data.settings.paymentMethod}>
            <option value="contact">I collect payment myself (owners tap "Request plan", I message them on WhatsApp)</option>
            <option value="upi">UPI QR in the owner's dashboard, verified by you</option>
            <option value="razorpay">Razorpay (automatic; needs Razorpay keys)</option>
          </Select>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Your UPI ID" name="upiId" defaultValue={data.settings.upiId ?? ""} placeholder="e.g. repeatly@ybl" hint="Owners pay to this. A business UPI ID is best." />
            <Input label="Name shown to payers" name="upiPayeeName" defaultValue={data.settings.upiPayeeName ?? ""} placeholder="Repeatly" maxLength={50} />
          </div>
          <label className="flex items-start gap-2 text-sm text-zinc-700">
            <input type="checkbox" name="provisionalAccess" defaultChecked={data.settings.provisionalAccess} className="mt-0.5 size-4 rounded border-zinc-300 accent-brand-500" />
            <span>
              Give 48-hour access while a UPI payment is being verified
              <span className="block text-xs text-zinc-500">Only once per account, and only for accounts not already on a paid plan. Rejecting takes it back.</span>
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>Save settings</Button>
        </div>
      </form>
    </Card>
  );
}

// ---------- Health ----------

interface HealthData {
  database: { ok: boolean; latencyMs: number; rowCounts: Record<string, number> };
  integrations: Record<string, boolean>;
  outbox: { queued: number; sending: number; oldestQueuedAgeSeconds: number | null; failedLast24h: number };
  environment: string;
}

const INTEGRATION_LABELS: Record<string, string> = {
  reviewAi: "Review AI (Cloudflare Workers AI / Gemini)",
  aiGateway: "Cloudflare AI Gateway",
  whatsapp: "WhatsApp Cloud API",
  whatsappWebhook: "WhatsApp webhook",
  razorpay: "Razorpay payments",
  razorpayWebhook: "Razorpay webhook",
  twilioOtp: "Twilio Verify (customer OTP)",
  turnstile: "Cloudflare Turnstile",
  email: "Transactional email (Resend)",
};

export function HealthPanel() {
  const { data, error, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => api<HealthData>("/api/admin/health"),
    refetchInterval: 30_000,
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const stale = (data.outbox.oldestQueuedAgeSeconds ?? 0) > 300;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">Environment: <Badge>{data.environment}</Badge></p>
        <Button size="sm" variant="secondary" loading={isFetching} onClick={() => refetch()}>Refresh</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Database" value={data.database.ok ? "Healthy" : "Down"} hint={`${data.database.latencyMs} ms round trip`} />
        <StatTile label="Messages queued" value={num(data.outbox.queued)} hint={`${num(data.outbox.sending)} sending`} />
        <StatTile
          label="Oldest queued"
          value={data.outbox.oldestQueuedAgeSeconds === null ? "—" : `${Math.round(data.outbox.oldestQueuedAgeSeconds / 60)} min`}
          hint={stale ? "Check the cron trigger" : "Outbox runs every minute"}
        />
        <StatTile label="Failed messages (24h)" value={num(data.outbox.failedLast24h)} />
      </div>
      <Card title="Integrations" description="Only whether each is configured; secret values are never shown.">
        <ul className="grid gap-2 sm:grid-cols-2">
          {Object.entries(data.integrations).map(([k, ok]) => (
            <li key={k} className="flex items-center justify-between rounded-lg border border-zinc-100 px-3 py-2 text-sm">
              <span>{INTEGRATION_LABELS[k] ?? k}</span>
              <Badge tone={ok ? "success" : "neutral"}>{ok ? "Configured" : "Not configured"}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Table sizes">
        <ul className="grid gap-x-6 text-sm sm:grid-cols-2">
          {Object.entries(data.database.rowCounts).map(([t, n]) => (
            <li key={t} className="flex justify-between border-b border-zinc-100 py-1.5">
              <code className="text-xs text-zinc-600">{t}</code>
              <span className="tabular-nums">{num(n)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------- Support inbox ----------

interface SupportMessage {
  id: string;
  name: string;
  contact: string;
  topic: "shop_owner" | "customer" | "privacy" | "other";
  businessName: string | null;
  message: string;
  status: "open" | "closed";
  createdAt: string;
}

const TOPIC_LABELS: Record<SupportMessage["topic"], string> = { shop_owner: "Shop owner", customer: "Customer", privacy: "Privacy / data", other: "Other" };

export function SupportPanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin", "support", status],
    queryFn: () => api<{ messages: SupportMessage[] }>(`/api/admin/support?status=${status}`),
  });
  const toggle = useMutation({
    mutationFn: (m: SupportMessage) => api(`/api/admin/support/${m.id}`, { method: "PATCH", body: { status: m.status === "open" ? "closed" : "open" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "support"] }),
  });

  return (
    <Card
      title="Support inbox"
      description="Messages from the public /support contact form. Reply by email or phone, then mark as done."
      actions={
        <Select label="" aria-label="Filter" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">Open</option>
          <option value="closed">Done</option>
          <option value="all">All</option>
        </Select>
      }
    >
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox error={error} />
      ) : data.messages.length === 0 ? (
        <EmptyState title="No messages" description={status === "open" ? "You're all caught up." : "Nothing here yet."} />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data.messages.map((m) => (
            <li key={m.id} className="space-y-2 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={m.topic === "privacy" ? "warning" : "neutral"}>{TOPIC_LABELS[m.topic]}</Badge>
                <span className="font-medium">{m.name}</span>
                <span className="text-zinc-500">· {m.contact}</span>
                {m.businessName && <span className="text-zinc-500">· {m.businessName}</span>}
                <span className="ml-auto text-xs text-zinc-400">{formatDateTimeIN(m.createdAt)}</span>
              </div>
              <p className="whitespace-pre-line text-zinc-700">{m.message}</p>
              <Button size="sm" variant={m.status === "open" ? "secondary" : "ghost"} loading={toggle.isPending && toggle.variables?.id === m.id} onClick={() => toggle.mutate(m)}>
                {m.status === "open" ? "Mark as done" : "Reopen"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- UPI payments to verify ----------

interface UpiPaymentRow {
  id: string;
  reference: string;
  utr: string | null;
  amountPaise: number;
  status: "created" | "paid" | "failed";
  failureReason: string | null;
  submittedAt: string;
  provisionalUntil: string | null;
  paidAt: string | null;
  planName: string;
  userName: string;
  userEmail: string;
  hasProof: boolean;
  businesses: string | null;
}

const REJECT_REASONS = ["UTR not found in bank statement", "Amount doesn't match", "Payment already used for another order"];

export function UpiPaymentsPanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const [rejecting, setRejecting] = useState<UpiPaymentRow | null>(null);
  const [reason, setReason] = useState(REJECT_REASONS[0]!);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin", "upi-payments", status],
    queryFn: () => api<{ payments: UpiPaymentRow[] }>(`/api/admin/upi-payments?status=${status}`),
  });
  const done = (text: string) => {
    setNotice({ tone: "success", text });
    qc.invalidateQueries({ queryKey: ["admin"] });
  };
  const approve = useMutation({
    mutationFn: (p: UpiPaymentRow) => api<{ periodEnd: string }>(`/api/admin/upi-payments/${p.id}/approve`, { method: "POST" }),
    onSuccess: (r, p) => done(`Approved ${p.reference}. ${p.planName} is active for ${p.userName} until ${formatDateIN(r.periodEnd)}.`),
    onError: (e) => setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "Could not approve" }),
  });
  const reject = useMutation({
    mutationFn: ({ p, reason }: { p: UpiPaymentRow; reason: string }) => api(`/api/admin/upi-payments/${p.id}/reject`, { body: { reason } }),
    onSuccess: (_r, { p }) => {
      setRejecting(null);
      done(`Rejected ${p.reference}. The owner will see the reason.`);
    },
    onError: (e) => setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "Could not reject" }),
  });

  return (
    <Card
      title="UPI payments"
      description="Check each payment in your bank or UPI app (match the amount and UTR), then approve or reject."
      actions={
        <Select label="" aria-label="Filter" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="pending">Waiting for you</option>
          <option value="all">All</option>
        </Select>
      }
    >
      {notice && (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}
      {isLoading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox error={error} />
      ) : !data.payments.length ? (
        <EmptyState title={status === "pending" ? "Nothing to verify" : "No UPI payments yet"} description="New UPI payments from shop owners appear here." />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {data.payments.map((p) => (
            <li key={p.id} className="space-y-3 py-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {formatINR(p.amountPaise)} · {p.planName}
                  </p>
                  <p className="text-zinc-600">
                    {p.userName} · {p.userEmail}
                    {p.businesses ? ` · ${p.businesses}` : ""}
                  </p>
                  <p className="text-xs text-zinc-500">Submitted {formatDateTimeIN(p.submittedAt)}</p>
                </div>
                <Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "warning"}>
                  {p.status === "paid" ? "Approved" : p.status === "failed" ? "Rejected" : "Waiting"}
                </Badge>
              </div>
              <div className="grid gap-2 rounded-lg bg-zinc-50 p-3 sm:grid-cols-2">
                <p>
                  <span className="text-xs text-zinc-500">UTR / transaction ID</span>
                  <span className="block font-mono font-semibold">{p.utr}</span>
                </p>
                <p>
                  <span className="text-xs text-zinc-500">Reference</span>
                  <span className="block font-mono font-semibold">{p.reference}</span>
                </p>
              </div>
              {p.provisionalUntil && p.status === "created" && (
                <p className="text-xs text-amber-700">48-hour access given until {formatDateTimeIN(p.provisionalUntil)}.</p>
              )}
              {p.failureReason && <p className="text-xs text-red-600">Reason: {p.failureReason}</p>}
              <div className="flex flex-wrap gap-2">
                {p.hasProof && (
                  <a href={`/api/admin/upi-payments/${p.id}/proof`} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="ghost">
                      View screenshot
                    </Button>
                  </a>
                )}
                {p.status === "created" && (
                  <>
                    <Button
                      size="sm"
                      loading={approve.isPending && approve.variables?.id === p.id}
                      onClick={() => {
                        if (confirm(`Did you find ${formatINR(p.amountPaise)} with UTR ${p.utr} in your bank? This activates ${p.planName} for 30 days.`)) approve.mutate(p);
                      }}
                    >
                      ✓ Approve
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setRejecting(p)}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.reference ?? ""}`}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {REJECT_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={`rounded-full border px-3 py-1 text-sm ${reason === r ? "border-red-400 bg-red-50 text-red-700" : "border-zinc-300"}`}>
                {r}
              </button>
            ))}
          </div>
          <Textarea label="Reason shown to the owner" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={reject.isPending} disabled={reason.trim().length < 3} onClick={() => rejecting && reject.mutate({ p: rejecting, reason: reason.trim() })}>
              Reject payment
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
