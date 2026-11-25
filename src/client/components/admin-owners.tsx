import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { formatDateIN, formatINR } from "../lib/billing-format";
import { BRAND } from "../lib/brand";
import { waLink } from "../lib/wa-draft";
import { Alert, Badge, Button, Card, cx, EmptyState, Input, ListLoader, Modal, Select, Textarea } from "./ui";
import { WhatsAppIcon } from "./WaSend";

type OwnerStatus = "active" | "expiring" | "expired" | "free";

interface Owner {
  userId: string;
  name: string;
  email: string;
  joinedAt: number;
  planCode: string | null;
  planName: string;
  pricePaise: number | null;
  periodEnd: number | null;
  daysLeft: number | null;
  status: OwnerStatus;
  shops: number;
  shopNames: string | null;
  phone: string | null;
  outlets: number;
  customers: number;
  lastPaidAt: number | null;
  lastActivityAt: number | null;
}

interface AdminPlan {
  id: string;
  code: string;
  name: string;
  pricePaise: number;
  intervalDays: number;
  isActive: boolean;
}

const STATUS_META: Record<OwnerStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "Active", tone: "success" },
  expiring: { label: "Expiring", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
  free: { label: "Free", tone: "neutral" },
};

const ago = (ts: number | null) => {
  if (!ts) return "No activity yet";
  const d = Math.floor((Date.now() - ts) / 86_400_000);
  return d <= 0 ? "Active today" : d === 1 ? "Active yesterday" : `Active ${d} days ago`;
};

/** Super Admin → Shop owners: plans, expiry, renew and WhatsApp reminders in one place. */
export function OwnersPanel() {
  const owners = useQuery({ queryKey: ["admin", "owners"], queryFn: () => api<{ owners: Owner[] }>("/api/admin/owners") });
  const plans = useQuery({ queryKey: ["admin", "plans"], queryFn: () => api<{ plans: AdminPlan[] }>("/api/admin/plans") });
  const settings = useQuery({ queryKey: ["admin", "settings"], queryFn: () => api<{ settings: { upiId: string | null } }>("/api/admin/settings") });
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | OwnerStatus>("all");
  const [plan, setPlan] = useState("");
  const [renewFor, setRenewFor] = useState<Owner | null>(null);
  const [remindFor, setRemindFor] = useState<Owner | null>(null);
  const [detailsFor, setDetailsFor] = useState<Owner | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const all = owners.data?.owners ?? [];
  const counts = useMemo(() => {
    const c: Record<"all" | OwnerStatus, number> = { all: all.length, active: 0, expiring: 0, expired: 0, free: 0 };
    for (const o of all) c[o.status]++;
    return c;
  }, [all]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (o) =>
        (tab === "all" || o.status === tab) &&
        (!plan || o.planCode === plan) &&
        (!needle || [o.name, o.email, o.phone ?? "", o.shopNames ?? ""].some((v) => v.toLowerCase().includes(needle))),
    );
  }, [all, q, tab, plan]);

  return (
    <div className="space-y-5">
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <SummaryBanner
          tone="red"
          icon="!"
          title={`${counts.expired} plan${counts.expired === 1 ? "" : "s"} expired`}
          text="Their paid period ended. Renew after payment, or send a WhatsApp reminder."
          onFilter={() => setTab("expired")}
        />
        <SummaryBanner
          tone="amber"
          icon="⏰"
          title={`${counts.expiring} expiring within 5 days`}
          text="Renewal due soon. Follow up for UPI payment."
          onFilter={() => setTab("expiring")}
        />
      </div>

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <Input label="" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email, phone or shop name…" />
          </div>
          <div className="flex flex-wrap rounded-xl bg-zinc-100 p-1 text-sm" role="tablist" aria-label="Filter by status">
            {(["all", "expiring", "expired", "active", "free"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cx(
                  "rounded-lg px-3 py-1.5 font-medium transition",
                  tab === t ? "bg-white shadow-sm" : "text-zinc-500 hover:text-zinc-800",
                  t === "expiring" && "text-amber-700",
                  t === "expired" && "text-red-700",
                )}
              >
                {t === "all" ? "All" : STATUS_META[t].label} ({counts[t]})
              </button>
            ))}
          </div>
          <div className="lg:w-44">
            <Select label="" aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="">All plans</option>
              {plans.data?.plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        {owners.isLoading ? (
          <ListLoader rows={6} />
        ) : owners.error ? (
          <Alert>{owners.error instanceof ApiError ? owners.error.message : "Could not load shop owners."}</Alert>
        ) : !list.length ? (
          <EmptyState title="No shop owners here" description="Try another filter or search." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {list.map((o) => (
              <li key={o.userId} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] lg:items-center">
                <button type="button" onClick={() => setDetailsFor(o)} className="min-w-0 text-left">
                  <p className="truncate font-semibold text-zinc-900 hover:text-brand-700">{o.name}</p>
                  <p className="truncate font-mono text-xs text-zinc-500">{o.email}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {o.phone && <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">📞 {o.phone}</span>}
                    {o.shopNames?.split(" · ").slice(0, 2).map((s) => (
                      <span key={s} className="max-w-[12rem] truncate rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
                        🏪 {s}
                      </span>
                    ))}
                    {o.shops > 2 && <span className="text-xs text-zinc-500">+{o.shops - 2} more</span>}
                  </div>
                </button>
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge>{o.planName}</Badge>
                    {o.status !== "free" && (
                      <span
                        className={cx(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          o.status === "expired" ? "bg-red-50 text-red-700" : o.status === "expiring" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700",
                        )}
                      >
                        {o.status === "expired" ? "Expired" : `${o.daysLeft}d left`}
                      </span>
                    )}
                  </div>
                  {o.periodEnd && o.status !== "free" && <p className="mt-1 text-xs text-zinc-500">{o.status === "expired" ? "Ended" : "Till"} {formatDateIN(o.periodEnd)}</p>}
                </div>
                <div className="text-xs text-zinc-600">
                  <p>
                    🏪 {o.outlets} outlet{o.outlets === 1 ? "" : "s"} · 👥 {o.customers} customers
                  </p>
                  <p className="mt-1 text-zinc-400">
                    Joined {formatDateIN(o.joinedAt)} · {ago(o.lastActivityAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button size="sm" onClick={() => setRenewFor(o)}>
                    Renew / change
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setRemindFor(o)}>
                    <span className="flex items-center gap-1.5 text-emerald-700">
                      <WhatsAppIcon /> Remind
                    </span>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDetailsFor(o)}>
                    Details
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RenewModal
        owner={renewFor}
        plans={plans.data?.plans.filter((p) => p.isActive) ?? []}
        onClose={() => setRenewFor(null)}
        onDone={(text) => {
          setRenewFor(null);
          setNotice(text);
        }}
      />
      <RemindModal owner={remindFor} upiId={settings.data?.settings.upiId ?? null} plans={plans.data?.plans ?? []} onClose={() => setRemindFor(null)} />
      <DetailsModal owner={detailsFor} onClose={() => setDetailsFor(null)} />
    </div>
  );
}

function SummaryBanner({ tone, icon, title, text, onFilter }: { tone: "red" | "amber"; icon: string; title: string; text: string; onFilter: () => void }) {
  return (
    <div className={cx("flex items-center gap-4 rounded-2xl border p-5", tone === "red" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50")}>
      <span
        className={cx("flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold", tone === "red" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700")}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx("font-bold", tone === "red" ? "text-red-800" : "text-amber-900")}>{title}</p>
        <p className={cx("text-sm", tone === "red" ? "text-red-700" : "text-amber-800")}>{text}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={onFilter}>
        Show
      </Button>
    </div>
  );
}

// ---------- Renew / change plan ----------

function RenewModal({ owner, plans, onClose, onDone }: { owner: Owner | null; plans: AdminPlan[]; onClose: () => void; onDone: (text: string) => void }) {
  const qc = useQueryClient();
  const [planCode, setPlanCode] = useState("");
  const [months, setMonths] = useState(1);
  const [mode, setMode] = useState<"extend" | "replace">("extend");
  const [record, setRecord] = useState(true);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = plans.find((p) => p.code === (planCode || owner?.planCode));
  const isPaid = !!selected && selected.pricePaise > 0;
  const days = months * (selected?.intervalDays ?? 30);
  const canExtend = !!owner && owner.status !== "expired" && owner.status !== "free" && selected?.code === owner.planCode;
  const defaultAmount = selected ? (selected.pricePaise * months) / 100 : 0;

  const save = useMutation({
    mutationFn: () =>
      api<{ currentPeriodEnd: string; extended: boolean }>(`/api/admin/subscriptions/${owner!.userId}`, {
        method: "PUT",
        body: {
          planCode: selected!.code,
          days: selected!.code === "free" ? 3650 : days,
          mode: canExtend ? mode : "replace",
          ...(record && isPaid ? { receivedPaise: Math.round(Number(amount || defaultAmount) * 100), receivedNote: note.trim() || undefined } : {}),
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      onDone(
        selected!.code === "free"
          ? `${owner!.name} moved to the Free plan.`
          : `${owner!.name} is on ${selected!.name} until ${formatDateIN(r.currentPeriodEnd)}${r.extended ? " (added to the current period)" : ""}.`,
      );
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not update the plan"),
  });

  return (
    <Modal
      open={!!owner}
      onClose={() => {
        setError(null);
        onClose();
      }}
      title={owner ? `Plan for ${owner.name}` : ""}
    >
      {owner && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600">
            Now: <b>{owner.planName}</b>
            {owner.periodEnd && owner.status !== "free" ? ` · ${owner.status === "expired" ? "ended" : "till"} ${formatDateIN(owner.periodEnd)}` : ""}
          </p>
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Plan" value={selected?.code ?? ""} onChange={(e) => setPlanCode(e.target.value)}>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} {p.pricePaise ? `· ${formatINR(p.pricePaise)}` : ""}
                </option>
              ))}
            </Select>
            {isPaid && (
              <Select label="How long" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))}>
                {[1, 2, 3, 6, 12].map((m) => (
                  <option key={m} value={m}>
                    {m} month{m === 1 ? "" : "s"} ({m * (selected?.intervalDays ?? 30)} days)
                  </option>
                ))}
              </Select>
            )}
          </div>
          {isPaid && canExtend && (
            <div className="grid gap-2 sm:grid-cols-2">
              {(["extend", "replace"] as const).map((m) => (
                <label key={m} className={cx("flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm", mode === m ? "border-brand-500 bg-brand-50/50" : "border-zinc-200")}>
                  <input type="radio" className="mt-0.5 accent-brand-500" checked={mode === m} onChange={() => setMode(m)} />
                  <span>
                    <b>{m === "extend" ? "Add to current period" : "Start from today"}</b>
                    <span className="block text-zinc-500">{m === "extend" ? `New end: ${formatDateIN((owner.periodEnd ?? Date.now()) + days * 86_400_000)}` : `New end: ${formatDateIN(Date.now() + days * 86_400_000)}`}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {isPaid && (
            <div className="space-y-3 rounded-xl bg-zinc-50 p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4 accent-brand-500" checked={record} onChange={(e) => setRecord(e.target.checked)} />
                I received the payment (record it in Revenue)
              </label>
              {record && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="Amount received (₹)" type="number" min={0} value={amount} placeholder={String(defaultAmount)} onChange={(e) => setAmount(e.target.value)} />
                  <Input label="Note (optional)" value={note} maxLength={60} placeholder="e.g. UPI 412345678901 / cash" onChange={(e) => setNote(e.target.value)} />
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={save.isPending} disabled={!selected} onClick={() => save.mutate()}>
              {selected?.code === "free" ? "Move to Free" : `Activate ${selected?.name ?? ""}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- WhatsApp reminder ----------

type Kind = "renew" | "expired" | "thanks" | "welcome";
type Lang = "hinglish" | "en";

function ownerMessage(kind: Kind, lang: Lang, o: Owner, amount: string, upiId: string | null) {
  const first = o.name.split(" ")[0] ?? o.name;
  const shop = o.shopNames?.split(" · ")[0] ?? "your shop";
  const end = o.periodEnd ? formatDateIN(o.periodEnd) : "";
  const pay = upiId ? (lang === "en" ? `\n\n💳 UPI ID: ${upiId}\n💰 Amount: ${amount}/month` : `\n\n💳 UPI ID: ${upiId}\n💰 Amount: ${amount}/month`) : "";
  const after =
    lang === "en"
      ? "\n\nAfter paying, enter the transaction ID in Repeatly → Plan & billing, or just reply here with the screenshot."
      : "\n\nPayment ke baad Repeatly app me Plan & billing me transaction ID daal dein, ya yahin screenshot bhej dein.";
  const sign = `\n\nThank you!\nTeam ${BRAND}`;
  if (lang === "en") {
    if (kind === "renew") return `Hello ${first}! 👋 Your ${BRAND} ${o.planName} plan for "${shop}" ends on ${end}.\nTo keep your loyalty cards and reviews running without a break, please renew.${pay}${after}${sign}`;
    if (kind === "expired") return `Hello ${first}, your ${BRAND} ${o.planName} plan for "${shop}" ended on ${end}, so the Free plan limits apply now.\nRenew anytime to get everything back.${pay}${after}${sign}`;
    if (kind === "thanks") return `Hello ${first}! ✅ We've received your payment. Your ${BRAND} ${o.planName} plan is active${end ? ` till ${end}` : ""}.${sign}`;
    return `Hello ${first}! 👋 Welcome to ${BRAND}. Need help setting up your stamp card or printing your QR poster for "${shop}"? Just reply here.${sign}`;
  }
  if (kind === "renew") return `Namaste ${first} ji! 👋 Aapke business "${shop}" ka ${BRAND} ${o.planName} plan ${end} ko khatam ho raha hai.\nService bina ruke chalu rakhne ke liye kripya renew karein.${pay}${after}${sign}`;
  if (kind === "expired") return `Namaste ${first} ji, aapke business "${shop}" ka ${BRAND} ${o.planName} plan ${end} ko khatam ho gaya hai, abhi Free plan ki limits chal rahi hain.\nRenew karke sab features wapas paayein.${pay}${after}${sign}`;
  if (kind === "thanks") return `Namaste ${first} ji! ✅ Aapka payment mil gaya hai. Aapka ${BRAND} ${o.planName} plan${end ? ` ${end} tak` : ""} active hai.${sign}`;
  return `Namaste ${first} ji! 👋 ${BRAND} me aapka swagat hai. "${shop}" ka stamp card ya QR poster set karne me madad chahiye to yahin reply karein.${sign}`;
}

function RemindModal({ owner, upiId, plans, onClose }: { owner: Owner | null; upiId: string | null; plans: AdminPlan[]; onClose: () => void }) {
  const [phone, setPhone] = useState("");
  const [kind, setKind] = useState<Kind>("renew");
  const [lang, setLang] = useState<Lang>("hinglish");
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastOwner, setLastOwner] = useState<string | null>(null);

  // Reset when a different owner is opened.
  if (owner && owner.userId !== lastOwner) {
    setLastOwner(owner.userId);
    setPhone(owner.phone ?? "");
    setKind(owner.status === "expired" ? "expired" : owner.status === "free" ? "welcome" : "renew");
    setEdited(false);
  }
  const plan = plans.find((p) => p.code === owner?.planCode);
  const amount = plan && plan.pricePaise > 0 ? formatINR(plan.pricePaise) : "";
  const generated = owner ? ownerMessage(kind, lang, owner, amount, upiId) : "";
  const message = edited ? text : generated;
  const digits = phone.replace(/\D/g, "");
  const validPhone = /^(91)?[6-9]\d{9}$/.test(digits);

  return (
    <Modal open={!!owner} onClose={onClose} title={owner ? `WhatsApp ${owner.name}` : ""}>
      {owner && (
        <div className="space-y-4">
          <Input
            label="WhatsApp number"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210"
            hint={owner.phone ? "From their shop settings. You can change it." : "No number saved for this owner. Type it here."}
            error={phone && !validPhone ? "Enter a 10-digit Indian mobile number" : undefined}
          />
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["renew", "⏰ Renewal due"],
                ["expired", "❗ Plan expired"],
                ["thanks", "✅ Payment received"],
                ["welcome", "👋 Welcome / help"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setEdited(false);
                }}
                className={cx("rounded-full border px-3 py-1.5 text-sm", kind === k ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-800" : "border-zinc-300 text-zinc-700")}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto inline-flex rounded-full bg-zinc-100 p-1 text-xs">
              {(["hinglish", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => {
                    setLang(l);
                    setEdited(false);
                  }}
                  className={cx("rounded-full px-2.5 py-1", lang === l ? "bg-white font-semibold shadow-sm" : "text-zinc-500")}
                >
                  {l === "en" ? "English" : "Hinglish"}
                </button>
              ))}
            </span>
          </div>
          {!upiId && (kind === "renew" || kind === "expired") && (
            <Alert tone="warning">Add your UPI ID in Settings so it appears in the message.</Alert>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-700">Message</span>
              <button
                type="button"
                className="text-sm font-medium text-emerald-700 hover:underline"
                onClick={async () => {
                  await navigator.clipboard.writeText(message).catch(() => undefined);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied ✓" : "Copy text"}
              </button>
            </div>
            <Textarea
              label=""
              aria-label="Message"
              rows={9}
              value={message}
              onChange={(e) => {
                setText(e.target.value);
                setEdited(true);
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <a
              href={validPhone ? waLink(digits, message) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!validPhone}
              className={cx(
                "inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white",
                validPhone ? "bg-[#25D366] hover:bg-[#1ebe5b]" : "pointer-events-none bg-zinc-300",
              )}
            >
              <WhatsAppIcon /> Open WhatsApp
            </a>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------- Details ----------

interface OwnerDetails {
  user: { name: string; email: string; createdAt: string };
  subscription: { status: string; currentPeriodEnd: string | null; planName: string } | null;
  shops: { id: string; name: string; slug: string; city: string | null; phone: string | null; whatsappNumber: string | null; status: string; customers: number; stamps: number; createdAt: number }[];
  payments: { id: string; provider: string; reference: string; paymentId: string | null; amountPaise: number; status: string; paidAt: string | null; createdAt: string; planName: string }[];
}

function DetailsModal({ owner, onClose }: { owner: Owner | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["admin", "owner", owner?.userId],
    queryFn: () => api<OwnerDetails>(`/api/admin/owners/${owner!.userId}`),
    enabled: !!owner,
  });
  const d = q.data;
  return (
    <Modal open={!!owner} onClose={onClose} title={owner?.name ?? ""}>
      {q.isLoading ? (
        <ListLoader rows={4} />
      ) : !d ? (
        <Alert>Could not load details.</Alert>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="rounded-xl bg-zinc-50 p-3">
            <p className="font-mono text-xs text-zinc-500">{d.user.email}</p>
            <p className="mt-1">
              <b>{d.subscription?.planName ?? "Free"}</b>
              {d.subscription?.currentPeriodEnd ? ` · till ${formatDateIN(d.subscription.currentPeriodEnd)}` : ""} · joined {formatDateIN(d.user.createdAt)}
            </p>
          </div>
          <section>
            <h3 className="mb-2 font-semibold">Shops ({d.shops.length})</h3>
            <ul className="space-y-2">
              {d.shops.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {[s.city, s.whatsappNumber ?? s.phone].filter(Boolean).join(" · ") || "No city / phone"} · {s.customers} customers · {s.stamps} stamps
                    </span>
                  </span>
                  <a href={`/s/${s.slug}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                    Shop page ↗
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 font-semibold">Payments</h3>
            {!d.payments.length ? (
              <p className="text-zinc-500">No payments yet.</p>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {d.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      {formatINR(p.amountPaise)} · {p.planName}
                      <span className="block text-xs text-zinc-500">
                        {formatDateIN(p.paidAt ?? p.createdAt)} · {p.provider === "upi_manual" ? "UPI" : p.provider === "manual" ? "Recorded by admin" : "Razorpay"} · {p.reference}
                      </span>
                    </span>
                    <Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "warning"}>
                      {p.status === "paid" ? "Paid" : p.status === "failed" ? "Rejected" : "Verifying"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
