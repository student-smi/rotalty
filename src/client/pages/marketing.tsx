import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { useBusinessContext } from "./business";
import type { Program } from "../lib/loyalty-api";
import { resolveParams, useTemplateText, WhatsAppPreview, type SampleValues } from "../components/WhatsAppPreview";
import { CUSTOMER_SEGMENTS, type CampaignType, type CustomerSegment } from "../../shared/domain";
import { formatDate, SEGMENT_LABELS } from "../lib/crm-api";
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, PageLoader, Select, Spinner, Textarea } from "../components/ui";

interface MarketingStatus {
  whatsappConfigured: boolean;
  planAllows: boolean;
  planName: string;
  monthlyLimit: number | null;
  usedThisMonth: number;
}

interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  mode: "one_off" | "automation";
  status: "draft" | "scheduled" | "running" | "active" | "paused" | "completed" | "cancelled" | "failed";
  templateName: string;
  templateLanguage: string;
  templateParams: string[];
  audience: { segment?: CustomerSegment };
  settings: { inactiveDays?: number };
  scheduledAt: string | null;
  createdAt: string;
  stats: Partial<Record<"queued" | "sending" | "sent" | "delivered" | "read" | "failed" | "skipped", number>>;
}

interface LogRow {
  id: string;
  status: string;
  error: string | null;
  recipient: string;
  customerName: string | null;
  createdAt: string;
  updatedAt: string;
}

const AUTOMATIONS: { type: CampaignType; title: string; description: string; defaultDays?: number }[] = [
  { type: "birthday", title: "Birthday wishes", description: "Sent at 9 AM on a customer's birthday (if they shared it)." },
  { type: "reward_unlock", title: "Reward unlocked", description: "Sent right after a customer earns enough points for a reward." },
  { type: "progress", title: "One stamp away", description: "Sent the day after a visit that leaves the customer one point from a reward." },
  { type: "winback", title: "Win-back", description: "Sent when a customer hasn't visited for a number of days.", defaultDays: 30 },
  { type: "inactive", title: "Inactive reminder", description: "A later nudge for customers who've been away longer.", defaultDays: 60 },
];

const ONE_OFF_TYPES: { type: CampaignType; label: string }[] = [
  { type: "occasion", label: "Special occasion / offer" },
  { type: "winback", label: "Win-back offer" },
  { type: "inactive", label: "Inactive customers" },
];

const STATUS_TONES: Record<Campaign["status"], "neutral" | "success" | "warning" | "danger" | "brand"> = {
  draft: "neutral",
  scheduled: "brand",
  running: "brand",
  active: "success",
  paused: "warning",
  completed: "success",
  cancelled: "neutral",
  failed: "danger",
};

const PLACEHOLDER_HELP = "One value per line, in the order of your template's {{1}}, {{2}}… You can use {{name}}, {{business}}, {{points}} and {{reward}}.";

const toLines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function errMessage(e: unknown) {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

export function MarketingPage() {
  const { business } = useBusinessContext();
  const base = `/api/businesses/${business.id}`;
  const status = useQuery({ queryKey: ["mkt-status", business.id], queryFn: () => api<MarketingStatus>(`${base}/marketing/status`) });
  const campaigns = useQuery({ queryKey: ["mkt-campaigns", business.id], queryFn: () => api<{ campaigns: Campaign[] }>(`${base}/campaigns`) });
  const [editing, setEditing] = useState<{ type: CampaignType; existing?: Campaign } | null>(null);
  const [logsFor, setLogsFor] = useState<Campaign | null>(null);

  if (status.isLoading || campaigns.isLoading) return <PageLoader />;
  if (status.error || !status.data) return <Alert>Could not load marketing settings.</Alert>;

  const st = status.data;
  const all = campaigns.data?.campaigns ?? [];
  const automations = all.filter((c) => c.mode === "automation");
  const oneOffs = all.filter((c) => c.mode === "one_off");
  const usagePct = st.monthlyLimit ? Math.min(100, Math.round((st.usedThisMonth / st.monthlyLimit) * 100)) : 0;
  const canUse = st.planAllows;

  return (
    <>
      <PageHeader title="Marketing" description="WhatsApp messages to customers who opted in" />
      <div className="space-y-6">
        {!st.planAllows && (
          <Alert tone="warning">
            Marketing automation isn't included in your {st.planName} plan.{" "}
            <Link to={`/app/b/${business.id}/subscription`} className="font-medium underline">
              Upgrade your plan
            </Link>{" "}
            to send WhatsApp campaigns.
          </Alert>
        )}
        {!st.whatsappConfigured && (
          <Alert tone="info">
            <p className="font-medium">WhatsApp Business isn't connected yet.</p>
            <p className="mt-1">
              Sending uses the official WhatsApp Business Platform (Cloud API). The platform admin must add <code>WHATSAPP_TOKEN</code>,{" "}
              <code>WHATSAPP_PHONE_NUMBER_ID</code>, <code>WHATSAPP_APP_SECRET</code> and <code>WHATSAPP_VERIFY_TOKEN</code>. Every message uses a template
              approved in WhatsApp Manager. You can prepare campaigns now; they can be sent once WhatsApp is connected.
            </p>
          </Alert>
        )}

        {st.planAllows && (
          <Card title="This month">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-zinc-600">Messages used</span>
              <span className="font-medium tabular-nums">
                {st.usedThisMonth} / {st.monthlyLimit ?? "Unlimited"}
              </span>
            </div>
            {st.monthlyLimit !== null && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div className={`h-full rounded-full ${usagePct >= 90 ? "bg-red-500" : "bg-brand-500"}`} style={{ width: `${usagePct}%` }} />
              </div>
            )}
          </Card>
        )}

        <section>
          <h2 className="mb-3 text-base font-semibold">Automations</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {AUTOMATIONS.map((a) => {
              const existing = automations.find((c) => c.type === a.type && c.status !== "cancelled");
              return (
                <AutomationCard
                  key={a.type}
                  base={base}
                  businessId={business.id}
                  meta={a}
                  campaign={existing}
                  disabled={!canUse}
                  onEdit={() => setEditing({ type: a.type, existing })}
                  onLogs={() => existing && setLogsFor(existing)}
                />
              );
            })}
          </div>
        </section>

        <Composer base={base} businessId={business.id} disabled={!canUse} />

        <Card title="Campaigns">
          {oneOffs.length === 0 ? (
            <EmptyState title="No campaigns yet" description="Create a campaign above to message customers who opted in." />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {oneOffs.map((cmp) => (
                <CampaignRow key={cmp.id} base={base} businessId={business.id} campaign={cmp} onLogs={() => setLogsFor(cmp)} />
              ))}
            </ul>
          )}
        </Card>

        <Card title="Compliance">
          <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-600">
            <li>Only customers who opted in to WhatsApp messages from {business.name} receive anything. Consent is checked again just before sending.</li>
            <li>Every message uses a template approved by Meta in WhatsApp Manager. Enter its exact name and language code.</li>
            <li>Customers can reply STOP at any time; they're unsubscribed automatically.</li>
            <li>Each customer gets at most one promotional message from you per 24 hours.</li>
          </ul>
        </Card>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.existing ? "Edit automation" : "Set up automation"}>
        {editing && <AutomationForm base={base} businessId={business.id} type={editing.type} existing={editing.existing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal open={!!logsFor} onClose={() => setLogsFor(null)} title={logsFor ? `Delivery log · ${logsFor.name}` : ""}>
        {logsFor && <LogsView base={base} campaignId={logsFor.id} />}
      </Modal>
    </>
  );
}

function StatsLine({ stats }: { stats: Campaign["stats"] }) {
  const parts = (["queued", "sent", "delivered", "read", "failed", "skipped"] as const).filter((k) => stats[k]).map((k) => `${stats[k]} ${k}`);
  return <p className="text-xs text-zinc-500">{parts.length ? parts.join(" · ") : "No messages yet"}</p>;
}

function useCampaignAction(base: string, businessId: string, onError: (m: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "send" | "activate" | "pause" | "cancel" }) =>
      api<{ status: string; queued?: number; skipped?: number }>(`${base}/campaigns/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mkt-campaigns", businessId] });
      qc.invalidateQueries({ queryKey: ["mkt-status", businessId] });
    },
    onError: (e) => onError(errMessage(e)),
  });
}

function AutomationCard({
  base,
  businessId,
  meta,
  campaign,
  disabled,
  onEdit,
  onLogs,
}: {
  base: string;
  businessId: string;
  meta: (typeof AUTOMATIONS)[number];
  campaign?: Campaign;
  disabled: boolean;
  onEdit: () => void;
  onLogs: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const action = useCampaignAction(base, businessId, setError);
  const editable = !campaign || ["draft", "paused"].includes(campaign.status);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{meta.title}</p>
          <p className="mt-0.5 text-sm text-zinc-500">{meta.description}</p>
        </div>
        {campaign && <Badge tone={STATUS_TONES[campaign.status]}>{campaign.status}</Badge>}
      </div>
      {campaign && (
        <div className="mt-2">
          <p className="text-xs text-zinc-500">
            Template <code>{campaign.templateName}</code> ({campaign.templateLanguage})
            {campaign.settings.inactiveDays ? ` · after ${campaign.settings.inactiveDays} days` : ""}
          </p>
          <StatsLine stats={campaign.stats} />
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!campaign ? (
          <Button size="sm" variant="secondary" disabled={disabled} onClick={onEdit}>
            Set up
          </Button>
        ) : (
          <>
            {editable && (
              <Button size="sm" variant="ghost" disabled={disabled} onClick={onEdit}>
                Edit
              </Button>
            )}
            {campaign.status === "active" ? (
              <Button size="sm" variant="secondary" loading={action.isPending} onClick={() => action.mutate({ id: campaign.id, action: "pause" })}>
                Pause
              </Button>
            ) : (
              ["draft", "paused"].includes(campaign.status) && (
                <Button
                  size="sm"
                  disabled={disabled}
                  loading={action.isPending}
                  onClick={() => {
                    setError(null);
                    action.mutate({ id: campaign.id, action: "activate" });
                  }}
                >
                  Activate
                </Button>
              )
            )}
            <Button size="sm" variant="ghost" onClick={onLogs}>
              Log
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Sample customer for message previews, using this shop's real name and reward. */
function useSampleValues(businessId: string): SampleValues {
  const { business } = useBusinessContext();
  const programs = useQuery({ queryKey: ["programs", businessId], queryFn: () => api<{ programs: Program[] }>(`/api/businesses/${businessId}/programs`) });
  const reward = programs.data?.programs.find((p) => p.status === "active")?.rewards.find((r) => r.isActive)?.name ?? "Free coffee";
  return { name: "Riya", business: business.name, points: "7", reward };
}

function TemplateTextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Textarea
      label="Template text (for preview only, optional)"
      rows={3}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={"Hi {{1}}! 🎉 {{2}} has a special Diwali offer for you…"}
      hint="Paste the message exactly as approved in WhatsApp Manager. It's only used for the preview and is saved on this device."
    />
  );
}

function AutomationForm({ base, businessId, type, existing, onDone }: { base: string; businessId: string; type: CampaignType; existing?: Campaign; onDone: () => void }) {
  const qc = useQueryClient();
  const meta = AUTOMATIONS.find((a) => a.type === type)!;
  const { business } = useBusinessContext();
  const sample = useSampleValues(businessId);
  const [templateName, setTemplateName] = useState(existing?.templateName ?? "");
  const [paramsText, setParamsText] = useState((existing?.templateParams ?? ["{{name}}", "{{business}}"]).join("\n"));
  const [templateText, setTemplateText] = useTemplateText(businessId, templateName);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      name: String(f.get("name")).trim(),
      templateName: String(f.get("templateName")).trim(),
      templateLanguage: String(f.get("templateLanguage")).trim(),
      templateParams: toLines(String(f.get("templateParams") ?? "")),
      ...(meta.defaultDays ? { settings: { inactiveDays: Number(f.get("inactiveDays")) } } : {}),
    };
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      if (existing) await api(`${base}/campaigns/${existing.id}`, { method: "PATCH", body });
      else await api(`${base}/campaigns`, { body: { ...body, type, mode: "automation" } });
      await qc.invalidateQueries({ queryKey: ["mkt-campaigns", businessId] });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors());
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <p className="text-sm text-zinc-600">{meta.description}</p>
      <Input label="Name" name="name" required minLength={2} maxLength={80} defaultValue={existing?.name ?? meta.title} error={fieldErrors.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Approved template name" name="templateName" required value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. birthday_offer" error={fieldErrors.templateName} />
        <Input label="Template language" name="templateLanguage" required defaultValue={existing?.templateLanguage ?? "en"} placeholder="en, hi, gu" error={fieldErrors.templateLanguage} />
      </div>
      {meta.defaultDays && (
        <Input
          label="Days since last visit"
          name="inactiveDays"
          type="number"
          min={7}
          max={365}
          required
          defaultValue={existing?.settings.inactiveDays ?? meta.defaultDays}
          error={fieldErrors["settings.inactiveDays"]}
        />
      )}
      <Textarea
        label="Template variables"
        name="templateParams"
        rows={3}
        value={paramsText}
        onChange={(e) => setParamsText(e.target.value)}
        hint={PLACEHOLDER_HELP}
        error={fieldErrors.templateParams}
      />
      <TemplateTextField value={templateText} onChange={setTemplateText} />
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">Preview for a sample customer</p>
        <WhatsAppPreview compact businessName={business.name} templateName={templateName} templateText={templateText} values={resolveParams(toLines(paramsText), sample)} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Save
        </Button>
      </div>
    </form>
  );
}

function Composer({ base, businessId, disabled }: { base: string; businessId: string; disabled: boolean }) {
  const qc = useQueryClient();
  const { business } = useBusinessContext();
  const sample = useSampleValues(businessId);
  const [templateName, setTemplateName] = useState("");
  const [paramsText, setParamsText] = useState("{{name}}\n{{business}}");
  const [templateText, setTemplateText] = useTemplateText(businessId, templateName);
  const [segment, setSegment] = useState<CustomerSegment | "">("");
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const preview = useQuery({
    queryKey: ["mkt-audience", businessId, segment],
    queryFn: () => api<{ count: number }>(`${base}/campaigns/audience-preview${segment ? `?segment=${segment}` : ""}`),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const when = String(f.get("scheduledAt") ?? "");
    setResult(null);
    setError(null);
    setDraft({
      name: String(f.get("name")).trim(),
      type: String(f.get("type")),
      mode: "one_off",
      templateName: String(f.get("templateName")).trim(),
      templateLanguage: String(f.get("templateLanguage")).trim(),
      templateParams: toLines(String(f.get("templateParams") ?? "")),
      audience: segment ? { segment } : {},
      scheduledAt: when ? new Date(when).toISOString() : null,
    });
  }

  async function confirm() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    let created: { id: string } | null = null;
    try {
      created = (await api<{ campaign: { id: string } }>(`${base}/campaigns`, { body: draft })).campaign;
      const res = await api<{ status: string; queued: number; skipped: number }>(`${base}/campaigns/${created.id}/send`, { method: "POST" });
      setResult(
        res.status === "scheduled"
          ? "Campaign scheduled."
          : `Campaign started: ${res.queued} message${res.queued === 1 ? "" : "s"} queued${res.skipped ? `, ${res.skipped} skipped (messaged in the last 24 hours)` : ""}.`,
      );
      setFormKey((k) => k + 1);
      setSegment("");
      setTemplateName("");
      setParamsText("{{name}}\n{{business}}");
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors());
      setError(created ? `Saved as a draft but not sent: ${errMessage(err)}` : errMessage(err));
    } finally {
      setBusy(false);
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["mkt-campaigns", businessId] });
      qc.invalidateQueries({ queryKey: ["mkt-status", businessId] });
    }
  }

  const scheduled = Boolean(draft?.scheduledAt);
  return (
    <Card title="New campaign" description="A one-time message to opted-in customers, now or at a scheduled time.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <form key={formKey} onSubmit={onSubmit} className="min-w-0 space-y-4">
        {result && <Alert tone="success">{result}</Alert>}
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Campaign name" name="name" required minLength={2} maxLength={80} placeholder="Diwali offer" error={fieldErrors.name} />
          <Select label="Type" name="type" defaultValue="occasion">
            {ONE_OFF_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Select label="Audience" value={segment} onChange={(e) => setSegment(e.target.value as CustomerSegment | "")}>
            <option value="">All opted-in customers</option>
            {CUSTOMER_SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {SEGMENT_LABELS[s]} customers
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-zinc-500">
            {preview.isLoading ? <Spinner className="inline size-3" /> : `${preview.data?.count ?? 0} customers can receive this (opted in, with a mobile number).`}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Approved template name" name="templateName" required value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. festive_offer" error={fieldErrors.templateName} />
          <Input label="Template language" name="templateLanguage" required defaultValue="en" error={fieldErrors.templateLanguage} />
        </div>
        <Textarea label="Template variables" name="templateParams" rows={3} value={paramsText} onChange={(e) => setParamsText(e.target.value)} hint={PLACEHOLDER_HELP} error={fieldErrors.templateParams} />
        <TemplateTextField value={templateText} onChange={setTemplateText} />
        <Input label="Schedule (optional)" name="scheduledAt" type="datetime-local" hint="Leave empty to send now." />
        <div className="flex justify-end">
          <Button type="submit" disabled={disabled}>
            Review & send
          </Button>
        </div>
      </form>
      <aside className="lg:sticky lg:top-6" aria-label="Message preview">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden /> What {sample.name} will see
        </p>
        <WhatsAppPreview businessName={business.name} templateName={templateName} templateText={templateText} values={resolveParams(toLines(paramsText), sample)} />
      </aside>
      </div>

      <Modal open={!!draft} onClose={() => !busy && setDraft(null)} title={scheduled ? "Schedule campaign?" : "Send campaign now?"}>
        <p className="text-sm text-zinc-600">
          "{String(draft?.name ?? "")}" will go to up to <strong>{preview.data?.count ?? 0}</strong> opted-in customers using template{" "}
          <code>{String(draft?.templateName ?? "")}</code>
          {scheduled ? ` on ${new Date(String(draft?.scheduledAt)).toLocaleString("en-IN")}` : ""}. Messages count toward your monthly limit.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={confirm}>
            {scheduled ? "Schedule" : "Send now"}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function CampaignRow({ base, businessId, campaign, onLogs }: { base: string; businessId: string; campaign: Campaign; onLogs: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const action = useCampaignAction(base, businessId, setError);
  const cancellable = ["draft", "scheduled", "running"].includes(campaign.status);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{campaign.name}</span>
            <Badge tone={STATUS_TONES[campaign.status]}>{campaign.status}</Badge>
          </p>
          <p className="text-xs text-zinc-500">
            {campaign.audience.segment ? `${SEGMENT_LABELS[campaign.audience.segment]} customers` : "All opted-in customers"} · <code>{campaign.templateName}</code> ·{" "}
            {campaign.scheduledAt ? `scheduled ${new Date(campaign.scheduledAt).toLocaleString("en-IN")}` : `created ${formatDate(campaign.createdAt)}`}
          </p>
          <StatsLine stats={campaign.stats} />
        </div>
        <div className="flex flex-wrap gap-2">
          {campaign.status === "draft" && (
            <Button
              size="sm"
              loading={action.isPending && action.variables?.action === "send"}
              onClick={() => {
                setError(null);
                if (confirm(`Send "${campaign.name}" now?`)) action.mutate({ id: campaign.id, action: "send" });
              }}
            >
              Send
            </Button>
          )}
          {cancellable && (
            <Button
              size="sm"
              variant="danger"
              loading={action.isPending && action.variables?.action === "cancel"}
              onClick={() => confirm(`Cancel "${campaign.name}"? Messages not yet sent will be skipped.`) && action.mutate({ id: campaign.id, action: "cancel" })}
            >
              Cancel
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onLogs}>
            Log
          </Button>
        </div>
      </div>
      {error && (
        <div className="mt-2">
          <Alert>{error}</Alert>
        </div>
      )}
    </li>
  );
}

const LOG_TONES: Record<string, "neutral" | "success" | "warning" | "danger" | "brand"> = {
  queued: "neutral",
  sending: "brand",
  sent: "brand",
  delivered: "success",
  read: "success",
  failed: "danger",
  skipped: "warning",
};

function LogsView({ base, campaignId }: { base: string; campaignId: string }) {
  const [pages, setPages] = useState<number[]>([0]);
  return (
    <div className="space-y-2">
      {pages.map((before, i) => (
        <LogsPage
          key={before}
          base={base}
          campaignId={campaignId}
          before={before}
          onMore={i === pages.length - 1 ? (next) => setPages((p) => [...p, next]) : undefined}
        />
      ))}
    </div>
  );
}

function LogsPage({ base, campaignId, before, onMore }: { base: string; campaignId: string; before: number; onMore?: (next: number) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["mkt-logs", campaignId, before],
    queryFn: () => api<{ logs: LogRow[]; nextBefore: number | null }>(`${base}/campaigns/${campaignId}/logs${before ? `?before=${before}` : ""}`),
  });
  if (isLoading) return <div className="flex justify-center py-4 text-zinc-400"><Spinner /></div>;
  if (error || !data) return <Alert>Could not load the log.</Alert>;
  if (!data.logs.length && !before) return <p className="text-sm text-zinc-500">No messages yet.</p>;
  return (
    <>
      <ul className="divide-y divide-zinc-100">
        {data.logs.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{l.customerName ?? "Customer"}</p>
              <p className="text-xs text-zinc-500">
                +{l.recipient} · {new Date(l.updatedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                {l.error ? ` · ${l.error}` : ""}
              </p>
            </div>
            <Badge tone={LOG_TONES[l.status] ?? "neutral"}>{l.status}</Badge>
          </li>
        ))}
      </ul>
      {onMore && data.nextBefore && (
        <Button size="sm" variant="secondary" className="w-full" onClick={() => onMore(data.nextBefore!)}>
          Load more
        </Button>
      )}
    </>
  );
}
