import { useState, type FormEvent } from "react";
import { Link, Navigate, useOutletContext } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Business, type BusinessResponse } from "../lib/api";
import { useMe } from "../lib/queries";
import { CATEGORY_LABELS, ROLE_LABELS } from "../lib/labels";
import { BUSINESS_CATEGORIES } from "../../shared/permissions";
import { Alert, Badge, Button, Card, Input, PageHeader, PageLoader, Select, Textarea } from "../components/ui";

export const useBusinessContext = () => useOutletContext<BusinessResponse>();

export function AppHome() {
  const { data, isLoading, error } = useMe();
  if (isLoading) return <PageLoader />;
  if (error || !data) return <div className="p-6"><Alert>Could not load your account. Please refresh.</Alert></div>;
  if (data.memberships.length === 0) return <Navigate to="/app/onboarding" replace />;
  if (data.memberships.length === 1) return <Navigate to={`/app/b/${data.memberships[0]!.businessId}`} replace />;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <PageHeader
        title="Your businesses"
        description={`Signed in as ${data.user.email}`}
        actions={<Link to="/app/onboarding"><Button variant="secondary">Add business</Button></Link>}
      />
      <ul className="space-y-3">
        {data.memberships.map((m) => (
          <li key={m.businessId}>
            <Link
              to={`/app/b/${m.businessId}`}
              className="flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-brand-500"
            >
              {m.logoUrl ? (
                <img src={m.logoUrl} alt="" className="size-11 rounded-lg object-cover" />
              ) : (
                <div className="flex size-11 items-center justify-center rounded-lg bg-brand-500 font-semibold text-white">{m.name[0]}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.name}</p>
                <p className="text-sm text-zinc-500">{CATEGORY_LABELS[m.category]}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone="brand">{ROLE_LABELS[m.role]}</Badge>
                {m.businessStatus === "suspended" && <Badge tone="danger">Suspended</Badge>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

type FieldErrors = Record<string, string>;

export function BusinessForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Partial<Business>;
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(
      [...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v).trim()]),
    );
    setLoading(true);
    setErrors({});
    setFormError(null);
    setSaved(false);
    try {
      await onSubmit(values);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.message);
      } else setFormError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handle} className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      {saved && initial && <Alert tone="success">Changes saved</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Business name" name="name" defaultValue={initial?.name} required minLength={2} maxLength={80} error={errors.name} />
        <Select label="Category" name="category" defaultValue={initial?.category ?? "cafe"} error={errors.category}>
          {BUSINESS_CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </Select>
        <Input label="Phone" name="phone" type="tel" inputMode="tel" placeholder="98765 43210" defaultValue={initial?.phone ?? ""} error={errors.phone} />
        <Input label="Email" name="email" type="email" defaultValue={initial?.email ?? ""} error={errors.email} />
      </div>
      <Textarea label="Short description" name="description" maxLength={500} defaultValue={initial?.description ?? ""} error={errors.description} hint="Shown to customers on your loyalty page" />
      <Input label="Address" name="addressLine" defaultValue={initial?.addressLine ?? ""} error={errors.addressLine} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="City" name="city" defaultValue={initial?.city ?? ""} error={errors.city} />
        <Input label="State" name="state" defaultValue={initial?.state ?? ""} error={errors.state} />
        <Input label="PIN code" name="pincode" inputMode="numeric" maxLength={6} defaultValue={initial?.pincode ?? ""} error={errors.pincode} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}

export function OverviewPage() {
  const { business, membership } = useBusinessContext();
  const can = (p: string) => membership.permissions.includes(p as never);
  const base = `/app/b/${business.id}`;
  const programs = useQuery({
    queryKey: ["programs", business.id],
    queryFn: () => api<{ programs: { id: string; status: string }[] }>(`/api/businesses/${business.id}/programs`),
  });
  const hasProgram = !!programs.data?.programs.some((p) => p.status === "active");
  const channels = useQuery({
    queryKey: ["channels", business.id],
    queryFn: () => api<{ qrCodes: { status: string }[] }>(`/api/businesses/${business.id}/channels`),
    enabled: can("loyalty.manage"),
  });
  const hasPoster = !!channels.data?.qrCodes.some((q) => q.status === "active");
  const reviews = useQuery({
    queryKey: ["review-settings", business.id],
    queryFn: () => api<{ settings: { enabled: boolean } }>(`/api/businesses/${business.id}/review-settings`),
    enabled: can("reviews.manage"),
  });

  const steps: { done: boolean; label: string; hint: string; to: string; show: boolean }[] = [
    { done: hasProgram, label: "Create your stamp card", hint: "Your offer, e.g. “Buy 9, get the 10th free”", to: `${base}/loyalty/new`, show: can("loyalty.manage") },
    { done: hasPoster, label: "Print your QR poster", hint: "Customers scan it at the counter to join", to: `${base}/qr-nfc/poster`, show: can("loyalty.manage") },
    { done: !!business.logoUrl, label: "Add your logo", hint: "Shows on every customer’s card", to: `${base}/settings`, show: can("business.manage") },
    { done: !!(business.addressLine && business.city), label: "Add your address", hint: "Helps customers find you", to: `${base}/settings`, show: can("business.manage") },
    { done: !!reviews.data?.settings.enabled, label: "Turn on Google review helper", hint: "Paste your Google review link", to: `${base}/reviews`, show: can("reviews.manage") },
  ].filter((s) => s.show);
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = steps.length > 0 && doneCount === steps.length;
  const canScan = can("points.issue") || can("rewards.redeem");

  return (
    <>
      <PageHeader title={`Welcome, ${business.name}`} description={allDone ? "Your shop is all set. Keep stamping!" : "A few quick steps to start bringing customers back."} />
      <div className="grid gap-6 lg:grid-cols-3">
        {steps.length > 0 && (
          <Card title={allDone ? "Setup complete 🎉" : "Getting started"} className="lg:col-span-2">
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-600">
                  {doneCount} of {steps.length} done
                </span>
                <span className="font-medium text-brand-700">{Math.round((doneCount / steps.length) * 100)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={steps.length}>
                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
              </div>
            </div>
            <ol className="divide-y divide-zinc-100">
              {steps.map((s, i) => (
                <li key={s.label} className="flex items-center gap-3 py-3">
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-emerald-500 text-white" : "border border-zinc-300 text-zinc-500"}`}
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${s.done ? "text-zinc-400 line-through" : "text-zinc-800"}`}>{s.label}</p>
                    {!s.done && <p className="text-xs text-zinc-500">{s.hint}</p>}
                  </div>
                  {!s.done && (
                    <Link to={s.to}>
                      <Button size="sm" variant="secondary">
                        Start
                      </Button>
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        )}
        <div className="space-y-6">
          {canScan && (
            <Card title="At the counter">
              <p className="text-sm text-zinc-600">Scan a customer's card to add a point or redeem a reward.</p>
              <Link to={`${base}/scan`} className="mt-4 block">
                <Button className="w-full">Open scanner</Button>
              </Link>
            </Card>
          )}
          {can("campaigns.manage") && <WaTodayCard businessId={business.id} base={base} />}
          <Card title="Your access">
            <p className="text-sm text-zinc-600">
              You are signed in as <Badge tone="brand">{ROLE_LABELS[membership.role]}</Badge>
            </p>
            {can("analytics.view") && (
              <Link to={`${base}/analytics`} className="mt-3 inline-block text-sm font-medium text-brand-600 hover:underline">
                View analytics
              </Link>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function WaTodayCard({ businessId, base }: { businessId: string; base: string }) {
  const q = useQuery({
    queryKey: ["wa-today", businessId],
    queryFn: () => api<{ birthdays: unknown[]; rewardReady: unknown[]; missYou: unknown[] }>(`/api/businesses/${businessId}/wa/today`),
  });
  if (!q.data) return null;
  const items = [
    { n: q.data.birthdays.length, label: "birthdays", emoji: "🎂" },
    { n: q.data.rewardReady.length, label: "rewards waiting", emoji: "🎁" },
    { n: q.data.missYou.length, label: "haven't visited lately", emoji: "😊" },
  ].filter((i) => i.n > 0);
  if (!items.length) return null;
  return (
    <Card title="💬 Today on WhatsApp">
      <ul className="space-y-1.5 text-sm text-zinc-700">
        {items.map((i) => (
          <li key={i.label}>
            {i.emoji} <b>{i.n}</b> {i.label}
          </li>
        ))}
      </ul>
      <Link to={`${base}/marketing`} className="mt-4 block">
        <Button className="w-full" variant="secondary">
          Send messages
        </Button>
      </Link>
    </Card>
  );
}
