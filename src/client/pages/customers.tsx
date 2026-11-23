import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useBusinessContext } from "./business";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "../../shared/domain";
import {
  CHANNEL_LABELS,
  formatDate,
  relativeDays,
  SEGMENT_LABELS,
  SEGMENT_TONES,
  type CrmCustomer,
  type CrmCustomerDetail,
  type SegmentStats,
} from "../lib/crm-api";
import { Alert, Badge, Button, Card, cx, EmptyState, Input, Modal, PageHeader, PageLoader, Spinner } from "../components/ui";

function SegmentBadges({ segments }: { segments: CustomerSegment[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {segments.map((s) => (
        <Badge key={s} tone={SEGMENT_TONES[s]}>
          {SEGMENT_LABELS[s]}
        </Badge>
      ))}
    </div>
  );
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CustomersPage() {
  const { business, membership } = useBusinessContext();
  const base = `/api/businesses/${business.id}`;
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [segment, setSegment] = useState<CustomerSegment | null>(null);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canExport = membership.permissions.includes("customers.export");

  useEffect(() => setPage(1), [q, segment]);

  const stats = useQuery({ queryKey: ["crm-stats", business.id], queryFn: () => api<{ stats: SegmentStats }>(`${base}/customers/stats`) });
  const params = new URLSearchParams({ page: String(page), ...(q && { q }), ...(segment && { segment }) });
  const list = useQuery({
    queryKey: ["crm-customers", business.id, params.toString()],
    queryFn: () => api<{ customers: CrmCustomer[]; hasMore: boolean }>(`${base}/customers?${params}`),
    placeholderData: keepPreviousData,
  });

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const exportParams = new URLSearchParams({ ...(q && { q }), ...(segment && { segment }) });
      const res = await fetch(`${base}/customers/export?${exportParams}`, { credentials: "same-origin" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(data?.error?.message ?? "Export failed");
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "customers.csv";
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const s = stats.data?.stats;
  const tiles: { key: CustomerSegment | null; label: string; value: number | undefined }[] = [
    { key: null, label: "All customers", value: s?.total },
    ...CUSTOMER_SEGMENTS.map((k) => ({ key: k, label: SEGMENT_LABELS[k], value: s?.[k] })),
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description={s ? `${s.total} customers · ${s.optedIn} opted in to WhatsApp` : "Everyone who joined your loyalty programs"}
        actions={
          canExport && (
            <Button variant="secondary" onClick={exportCsv} loading={exporting}>
              Export CSV
            </Button>
          )
        }
      />
      {exportError && (
        <div className="mb-4">
          <Alert>{exportError}</Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <button
            key={t.label}
            onClick={() => setSegment(t.key)}
            className={cx(
              "rounded-xl border bg-white p-3 text-left shadow-sm transition",
              segment === t.key ? "border-brand-500 ring-2 ring-brand-500/20" : "border-zinc-200 hover:border-zinc-300",
            )}
          >
            <p className="text-xs text-zinc-500">{t.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{t.value ?? "—"}</p>
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-4">
          <Input placeholder="Search by name or mobile number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search customers" />
        </div>
        {list.isLoading ? (
          <div className="flex justify-center py-10 text-zinc-400">
            <Spinner />
          </div>
        ) : list.error ? (
          <Alert>Could not load customers. {list.error instanceof ApiError ? list.error.message : ""}</Alert>
        ) : !list.data?.customers.length ? (
          <EmptyState
            title={q || segment ? "No customers match" : "No customers yet"}
            description={q || segment ? "Try a different search or segment." : "Customers appear here once they join a loyalty program from your QR code or NFC tag."}
          />
        ) : (
          <>
            <ul className="divide-y divide-zinc-100 md:hidden">
              {list.data.customers.map((cu) => (
                <li key={cu.id}>
                  <Link to={`/app/b/${business.id}/customers/${cu.id}`} className="block py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{cu.name}</p>
                      {cu.whatsappOptIn && <Badge tone="success">WhatsApp</Badge>}
                    </div>
                    <p className="text-sm text-zinc-500">
                      {cu.phone ?? "—"} · {cu.visits} visits · {cu.pointsBalance} pts · {relativeDays(cu.lastVisitAt)}
                    </p>
                    <div className="mt-1.5">
                      <SegmentBadges segments={cu.segments} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="-mx-5 hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-100 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-5 py-2 font-medium">Customer</th>
                    <th className="px-5 py-2 font-medium">Visits</th>
                    <th className="px-5 py-2 font-medium">Points</th>
                    <th className="px-5 py-2 font-medium">Last visit</th>
                    <th className="px-5 py-2 font-medium">Segments</th>
                    <th className="px-5 py-2 font-medium">WhatsApp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {list.data.customers.map((cu) => (
                    <tr key={cu.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-3">
                        <Link to={`/app/b/${business.id}/customers/${cu.id}`} className="font-medium text-zinc-900 hover:text-brand-600">
                          {cu.name}
                        </Link>
                        <p className="text-xs text-zinc-500">{cu.phone ?? "—"}</p>
                      </td>
                      <td className="px-5 py-3 tabular-nums">{cu.visits}</td>
                      <td className="px-5 py-3 tabular-nums">{cu.pointsBalance}</td>
                      <td className="px-5 py-3 text-zinc-500">{relativeDays(cu.lastVisitAt)}</td>
                      <td className="px-5 py-3">
                        <SegmentBadges segments={cu.segments} />
                      </td>
                      <td className="px-5 py-3">{cu.whatsappOptIn ? <Badge tone="success">Opted in</Badge> : <span className="text-zinc-400">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-xs text-zinc-500">Page {page}</span>
              <Button size="sm" variant="secondary" disabled={!list.data.hasMore} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

const CONSENT_SOURCE_LABELS: Record<string, string> = {
  join_form: "Customer opted in when joining",
  customer_settings: "Customer's own settings",
  business_on_request: "Recorded by staff at customer's request",
  whatsapp_stop: "Customer replied STOP on WhatsApp",
  account_deleted: "Customer deleted their data",
};

export function CustomerDetailPage() {
  const { business, membership } = useBusinessContext();
  const { customerId = "" } = useParams();
  const qc = useQueryClient();
  const base = `/api/businesses/${business.id}`;
  const key = ["crm-customer", business.id, customerId];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api<CrmCustomerDetail>(`${base}/customers/${customerId}`) });
  const [confirmChannel, setConfirmChannel] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const canManageCards = membership.permissions.includes("loyalty.manage");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["crm-customers", business.id] });
    qc.invalidateQueries({ queryKey: ["crm-stats", business.id] });
  };
  const onError = (e: unknown) => setActionError(e instanceof ApiError ? e.message : "Something went wrong");

  const setCardStatus = useMutation({
    mutationFn: ({ cardId, status }: { cardId: string; status: "active" | "blocked" }) => api(`${base}/cards/${cardId}`, { method: "PATCH", body: { status } }),
    onSuccess: refresh,
    onError,
  });
  const withdraw = useMutation({
    mutationFn: (channel: string) => api(`${base}/customers/${customerId}/consents/${channel}`, { method: "PUT", body: { action: "withdraw" } }),
    onSuccess: () => {
      setConfirmChannel(null);
      refresh();
    },
    onError,
  });

  if (isLoading) return <PageLoader />;
  if (error || !data) {
    return (
      <>
        <Alert>{error instanceof ApiError && error.status === 404 ? "This customer was not found at your business." : "Could not load this customer."}</Alert>
        <Link to={`/app/b/${business.id}/customers`} className="mt-4 inline-block text-sm font-medium text-brand-600">
          ← Back to customers
        </Link>
      </>
    );
  }

  const { customer, cards, history, redemptions, consents } = data;
  const stats = [
    { label: "Visits", value: customer.visits },
    { label: "Points balance", value: customer.pointsBalance },
    { label: "Lifetime points", value: customer.lifetimePoints },
    { label: "Rewards redeemed", value: customer.rewardsRedeemed },
  ];
  const timeline = [
    ...history.map((h) => ({
      id: h.id,
      at: h.createdAt,
      text:
        h.type === "earn"
          ? `+${h.points} point · ${h.programName} · ${CHANNEL_LABELS[h.channel] ?? h.channel}${h.staffName ? ` by ${h.staffName}` : ""}`
          : h.type === "redeem"
            ? `${h.points} points used · ${h.programName}${h.staffName ? ` by ${h.staffName}` : ""}`
            : `${h.points > 0 ? "+" : ""}${h.points} adjustment · ${h.programName}`,
      tone: h.type === "earn" ? "bg-emerald-500" : "bg-brand-500",
    })),
    ...redemptions.map((r) => ({ id: r.id, at: r.createdAt, text: `Redeemed "${r.rewardName}"`, tone: "bg-amber-500" })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <>
      <Link to={`/app/b/${business.id}/customers`} className="mb-4 inline-block text-sm text-zinc-500 hover:text-zinc-800">
        ← Customers
      </Link>
      <PageHeader
        title={customer.name}
        description={[customer.phone, customer.email, customer.birthday ? `Birthday ${customer.birthday}` : null, `Joined ${formatDate(customer.joinedAt)}`]
          .filter(Boolean)
          .join(" · ")}
        actions={customer.phone && <a href={`tel:+91${customer.phone}`} className="text-sm font-medium text-brand-600">Call</a>}
      />
      {actionError && (
        <div className="mb-4">
          <Alert>{actionError}</Alert>
        </div>
      )}
      <div className="mb-4">
        <SegmentBadges segments={customer.segments} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-zinc-500">{s.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Loyalty cards">
            <ul className="space-y-4">
              {cards.map((card) => {
                const pct = Math.min(100, Math.round((card.pointsBalance / Math.max(1, card.stampsRequired)) * 100));
                return (
                  <li key={card.id} className="rounded-lg border border-zinc-100 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{card.programName}</p>
                        <p className="text-xs text-zinc-500">
                          {card.visits} visits · last {relativeDays(card.lastVisitAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {card.status === "blocked" && <Badge tone="danger">Blocked</Badge>}
                        {canManageCards && (
                          <Button
                            size="sm"
                            variant={card.status === "active" ? "danger" : "secondary"}
                            loading={setCardStatus.isPending && setCardStatus.variables?.cardId === card.id}
                            onClick={() => setCardStatus.mutate({ cardId: card.id, status: card.status === "active" ? "blocked" : "active" })}
                          >
                            {card.status === "active" ? "Block card" : "Unblock"}
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-500">
                      {card.pointsBalance} / {card.stampsRequired} stamps
                      {card.rewards.length > 0 && ` · rewards at ${card.rewards.map((r) => `${r.pointsRequired} (${r.name})`).join(", ")}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Activity">
            {timeline.length === 0 ? (
              <p className="text-sm text-zinc-500">No visits yet.</p>
            ) : (
              <ol className="space-y-3">
                {timeline.map((t) => (
                  <li key={t.id} className="flex gap-3">
                    <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", t.tone)} />
                    <div>
                      <p className="text-sm text-zinc-800">{t.text}</p>
                      <p className="text-xs text-zinc-500">{new Date(t.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <Card title="Communication consent" description="Customers control their own consent. You can only record a withdrawal they ask for.">
          <ul className="space-y-3">
            {consents.map((cs) => (
              <li key={cs.channel} className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium capitalize">{cs.channel}</p>
                  <p className="text-xs text-zinc-500">
                    {cs.status === null
                      ? "Not given"
                      : `${cs.status === "granted" ? "Granted" : "Withdrawn"} · ${CONSENT_SOURCE_LABELS[cs.source ?? ""] ?? cs.source ?? ""}`}
                  </p>
                </div>
                {cs.status === "granted" ? (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmChannel(cs.channel)}>
                    Record withdrawal
                  </Button>
                ) : (
                  <Badge tone={cs.status === "withdrawn" ? "warning" : "neutral"}>{cs.status === "withdrawn" ? "Withdrawn" : "None"}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Modal open={!!confirmChannel} onClose={() => setConfirmChannel(null)} title="Record consent withdrawal">
        <p className="text-sm text-zinc-600">
          Only do this if {customer.name} asked you to stop sending {confirmChannel} messages. They will stop receiving marketing messages from {business.name} on
          this channel. Only the customer can opt back in.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmChannel(null)}>
            Cancel
          </Button>
          <Button variant="danger" loading={withdraw.isPending} onClick={() => confirmChannel && withdraw.mutate(confirmChannel)}>
            Record withdrawal
          </Button>
        </div>
      </Modal>
    </>
  );
}
