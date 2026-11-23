import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { formatDateIN, formatINR } from "../lib/billing-format";
import { PLAN_LIMIT_LABELS, type PlanLimits } from "../../shared/domain";
import { Alert, Badge, Button, Card, cx, EmptyState, PageHeader, PageLoader } from "../components/ui";
import { UsageBar } from "../components/analytics-charts";
import { useBusinessContext } from "./business";

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricePaise: number;
  intervalDays: number;
  limits: PlanLimits;
}

interface SubscriptionInfo {
  plan: Plan;
  subscription: { status: "active" | "expired" | "cancelled"; currentPeriodEnd: string | null; planId: string } | null;
  account: { businesses: { used: number; limit: number | null } };
  businesses: { businessId: string; name: string; usage: Record<string, { used: number; limit: number | null }> }[];
}

interface Payment {
  id: string;
  orderId: string;
  paymentId: string | null;
  amountPaise: number;
  status: "created" | "paid" | "failed";
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
  planName: string;
}

interface CheckoutOrder {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  planName: string;
  prefill: { name: string; email: string };
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: (r: { error?: { description?: string } }) => void) => void };
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const s = existing ?? Object.assign(document.createElement("script"), { src: CHECKOUT_SRC, async: true });
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("Could not load Razorpay. Check your connection.")));
    if (!existing) document.head.appendChild(s);
  });
}

const BOOLEAN_LIMITS: (keyof PlanLimits)[] = ["nfc", "marketing", "advancedAnalytics"];
const COUNT_LIMITS = (Object.keys(PLAN_LIMIT_LABELS) as (keyof PlanLimits)[]).filter((k) => !BOOLEAN_LIMITS.includes(k));

function limitText(key: keyof PlanLimits, value: PlanLimits[keyof PlanLimits]) {
  if (typeof value === "boolean") return value ? PLAN_LIMIT_LABELS[key] : null;
  return `${value === null ? "Unlimited" : value.toLocaleString("en-IN")} ${PLAN_LIMIT_LABELS[key].toLowerCase()}`;
}

export function SubscriptionPage() {
  const { business, membership } = useBusinessContext();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const plans = useQuery({ queryKey: ["billing", "plans"], queryFn: () => api<{ plans: Plan[]; paymentsAvailable: boolean }>("/api/billing/plans") });
  const sub = useQuery({ queryKey: ["billing", "subscription"], queryFn: () => api<SubscriptionInfo>("/api/billing/subscription") });
  const payments = useQuery({ queryKey: ["billing", "payments"], queryFn: () => api<{ payments: Payment[] }>("/api/billing/payments") });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["billing"] });
    qc.invalidateQueries({ queryKey: ["analytics"] });
    qc.invalidateQueries({ queryKey: ["channels"] });
  };

  const verify = useMutation({
    mutationFn: (r: RazorpayResponse) =>
      api<{ status: string; currentPeriodEnd: string | null; plan: Plan }>("/api/billing/verify", {
        body: { orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature },
      }),
    onSuccess: (res) => {
      setNotice({ tone: "success", text: `Payment successful. You're on ${res.plan.name} until ${formatDateIN(res.currentPeriodEnd)}.` });
      refresh();
    },
    onError: (e) =>
      setNotice({
        tone: "error",
        text: `${e instanceof ApiError ? e.message : "We couldn't confirm the payment."} If money was deducted and your plan doesn't update within a few minutes, contact support with your payment ID.`,
      }),
    onSettled: () => setBusyPlan(null),
  });

  async function startCheckout(plan: Plan) {
    setNotice(null);
    setBusyPlan(plan.code);
    try {
      const [order] = await Promise.all([api<CheckoutOrder>("/api/billing/checkout", { body: { planCode: plan.code } }), loadCheckout()]);
      const rzp = new window.Razorpay!({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: order.currency,
        name: "Graahak",
        description: `${order.planName} plan — ${plan.intervalDays} days`,
        prefill: order.prefill,
        theme: { color: "#5b5bd6" },
        handler: (r: RazorpayResponse) => verify.mutate(r),
        modal: {
          ondismiss: () => {
            setBusyPlan(null);
            setNotice({ tone: "info", text: "Payment cancelled. You have not been charged." });
            qc.invalidateQueries({ queryKey: ["billing", "payments"] });
          },
        },
      });
      rzp.on("payment.failed", (r) => {
        setNotice({ tone: "error", text: r.error?.description ?? "Payment failed. Please try another method." });
      });
      rzp.open();
    } catch (e) {
      setBusyPlan(null);
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "Could not start the payment." });
    }
  }

  if (!membership.permissions.includes("billing.manage")) {
    return (
      <>
        <PageHeader title="Subscription" />
        <Alert tone="info">Only the business owner can manage the subscription.</Alert>
      </>
    );
  }
  if (plans.isLoading || sub.isLoading) return <PageLoader />;
  if (plans.error || sub.error || !plans.data || !sub.data) return <Alert>Could not load your subscription. Please refresh.</Alert>;

  const current = sub.data;
  const expired = current.subscription?.status === "expired";
  const thisBusiness = current.businesses.find((b) => b.businessId === business.id);

  return (
    <>
      <PageHeader title="Subscription" description="Your plan covers every business you own" />
      <div className="space-y-6">
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        {!plans.data.paymentsAvailable && (
          <Alert tone="warning">Online payments are not configured yet. Contact support to change your plan.</Alert>
        )}

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-500">Current plan</p>
              <p className="mt-1 flex items-center gap-2 text-2xl font-semibold">
                {current.plan.name}
                {expired ? <Badge tone="danger">Expired</Badge> : current.plan.pricePaise > 0 ? <Badge tone="success">Active</Badge> : <Badge>Free</Badge>}
              </p>
              {current.plan.pricePaise > 0 && current.subscription?.currentPeriodEnd && (
                <p className="mt-1 text-sm text-zinc-500">Paid until {formatDateIN(current.subscription.currentPeriodEnd)}</p>
              )}
              {expired && <p className="mt-1 text-sm text-red-600">Your paid period ended, so Free plan limits now apply.</p>}
            </div>
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Plans don't renew automatically — pay again to extend. A new plan starts immediately (no proration). If you go over a
            lower plan's limits, nothing is deleted; you just can't add more until you upgrade.
          </p>
        </Card>

        <Card title="Usage" description={`${business.name} · this month`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <UsageBar label="Businesses (account)" used={current.account.businesses.used} limit={current.account.businesses.limit} />
            {thisBusiness &&
              Object.entries(thisBusiness.usage).map(([key, u]) => (
                <UsageBar key={key} label={PLAN_LIMIT_LABELS[key as keyof PlanLimits]} used={u.used} limit={u.limit} />
              ))}
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.data.plans.map((plan) => {
            const isCurrent = plan.code === current.plan.code && !expired;
            const features = [...COUNT_LIMITS.map((k) => limitText(k, plan.limits[k])), ...BOOLEAN_LIMITS.map((k) => limitText(k, plan.limits[k]))].filter(Boolean);
            return (
              <div
                key={plan.id}
                className={cx(
                  "flex flex-col rounded-xl border bg-white p-5 shadow-sm",
                  isCurrent ? "border-brand-500 ring-2 ring-brand-500/20" : "border-zinc-200",
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{plan.name}</h3>
                  {isCurrent && <Badge tone="brand">Current</Badge>}
                </div>
                {plan.description && <p className="mt-1 text-sm text-zinc-500">{plan.description}</p>}
                <p className="mt-4">
                  <span className="text-3xl font-semibold tabular-nums">{formatINR(plan.pricePaise)}</span>
                  {plan.pricePaise > 0 && <span className="text-sm text-zinc-500"> / {plan.intervalDays} days</span>}
                </p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-zinc-600">
                  {features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-brand-500" aria-hidden>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.pricePaise > 0 && (
                  <Button
                    className="mt-5 w-full"
                    variant={isCurrent ? "secondary" : "primary"}
                    disabled={!plans.data.paymentsAvailable || (busyPlan !== null && busyPlan !== plan.code)}
                    loading={busyPlan === plan.code}
                    onClick={() => startCheckout(plan)}
                  >
                    {isCurrent ? `Renew ${plan.intervalDays} days` : `Switch to ${plan.name}`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <Card title="Payment history">
          {payments.isLoading ? (
            <PageLoader />
          ) : !payments.data?.payments.length ? (
            <EmptyState title="No payments yet" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {payments.data.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {p.planName} · {formatINR(p.amountPaise)}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {formatDateIN(p.paidAt ?? p.createdAt)} · {p.paymentId ?? p.orderId}
                      {p.failureReason ? ` · ${p.failureReason}` : ""}
                    </p>
                  </div>
                  <Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "neutral"}>
                    {p.status === "created" ? "Not completed" : p.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
