import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { formatDate, STAMP_ICONS, stampEmoji, type Program, type Reward } from "../lib/loyalty-api";
import { PROGRAM_STATUSES, type ProgramStatus } from "../../shared/domain";
import { Alert, Badge, Button, Card, cx, EmptyState, Input, Modal, PageHeader, Select, Spinner, Textarea } from "../components/ui";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { useBusinessContext } from "./business";

const STATUS_TONE: Record<ProgramStatus, "success" | "warning" | "neutral" | "danger"> = {
  active: "success",
  paused: "warning",
  draft: "neutral",
  archived: "danger",
};

const toDateInput = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

function PlanLimitAlert({ error, businessId }: { error: ApiError; businessId: string }) {
  return (
    <Alert tone="warning">
      {error.message}{" "}
      <Link to={`/app/b/${businessId}/subscription`} className="font-medium underline">
        View plans
      </Link>
    </Alert>
  );
}

export function LoyaltyProgramsPage() {
  const { business, membership } = useBusinessContext();
  const canManage = membership.permissions.includes("loyalty.manage");
  const key = ["programs", business.id];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api<{ programs: Program[] }>(`/api/businesses/${business.id}/programs`) });
  const [editing, setEditing] = useState<Program | "new" | null>(null);

  return (
    <>
      <PageHeader
        title="Loyalty programs"
        description="Digital stamp cards your customers collect on every visit"
        actions={canManage && <Button onClick={() => setEditing("new")}>New program</Button>}
      />
      {isLoading ? (
        <div className="flex justify-center py-12 text-zinc-400">
          <Spinner />
        </div>
      ) : error ? (
        <Alert>Could not load programs. Please refresh.</Alert>
      ) : !data?.programs.length ? (
        <EmptyState
          title="No loyalty program yet"
          description="Create your first stamp card, for example “Buy 9 coffees, get the 10th free”."
          action={canManage && <Button onClick={() => setEditing("new")}>Create program</Button>}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {data.programs.map((p) => (
            <ProgramCard key={p.id} program={p} businessId={business.id} businessName={business.name} logoUrl={business.logoUrl} canManage={canManage} onEdit={() => setEditing(p)} />
          ))}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "New loyalty program" : "Edit program"}>
        {editing !== null && (
          <ProgramForm
            businessId={business.id}
            businessName={business.name}
            logoUrl={business.logoUrl}
            program={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}

function ProgramCard({
  program,
  businessId,
  businessName,
  logoUrl,
  canManage,
  onEdit,
}: {
  program: Program;
  businessId: string;
  businessName: string;
  logoUrl: string | null;
  canManage: boolean;
  onEdit: () => void;
}) {
  const active = program.rewards.filter((r) => r.isActive);
  return (
    <Card
      title={program.name}
      description={program.description ?? undefined}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[program.status]}>{program.status}</Badge>
          {canManage && (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
          )}
        </div>
      }
    >
      <LoyaltyCard
        businessName={businessName}
        logoUrl={logoUrl}
        programName={program.name}
        stampIcon={program.stampIcon}
        stampsRequired={program.stampsRequired}
        points={Math.min(3, program.stampsRequired - 1)}
        rewards={active}
        customerName="Preview"
        compact
      />
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-zinc-500">Stamps</dt>
          <dd className="font-medium">
            {stampEmoji(program.stampIcon)} {program.stampsRequired}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Per customer / day</dt>
          <dd className="font-medium">{program.dailyLimitPerCustomer}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Runs</dt>
          <dd className="font-medium">
            {program.startsAt ? formatDate(program.startsAt) : "Now"} – {program.endsAt ? formatDate(program.endsAt) : "No end"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Min purchase</dt>
          <dd className="font-medium">{program.minPurchaseAmount ? `₹${program.minPurchaseAmount}` : "—"}</dd>
        </div>
      </dl>
      <RewardsEditor program={program} businessId={businessId} canManage={canManage} />
    </Card>
  );
}

function RewardsEditor({ program, businessId, canManage }: { program: Program; businessId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Reward | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (r: Reward) => api(`/api/businesses/${businessId}/rewards/${r.id}`, { method: "PATCH", body: { isActive: !r.isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["programs", businessId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not update reward"),
  });

  return (
    <div className="mt-5 border-t border-zinc-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Rewards</h3>
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
            Add reward
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-zinc-100">
        {program.rewards.map((r) => (
          <li key={r.id} className={cx("flex items-center gap-3 py-2.5", !r.isActive && "opacity-50")}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">{r.pointsRequired}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}</p>
              {r.description && <p className="truncate text-xs text-zinc-500">{r.description}</p>}
            </div>
            {!r.isActive && <Badge>Off</Badge>}
            {canManage && (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" loading={toggle.isPending && toggle.variables?.id === r.id} onClick={() => toggle.mutate(r)}>
                  {r.isActive ? "Turn off" : "Turn on"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add reward" : "Edit reward"}>
        {editing !== null && <RewardForm businessId={businessId} program={program} reward={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function RewardForm({ businessId, program, reward, onDone }: { businessId: string; program: Program; reward: Reward | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: String(f.get("name")).trim(),
      description: String(f.get("description")).trim(),
      pointsRequired: Number(f.get("pointsRequired")),
    };
    setLoading(true);
    setErrors({});
    setFormError(null);
    try {
      await api(reward ? `/api/businesses/${businessId}/rewards/${reward.id}` : `/api/businesses/${businessId}/programs/${program.id}/rewards`, {
        method: reward ? "PATCH" : "POST",
        body,
      });
      await qc.invalidateQueries({ queryKey: ["programs", businessId] });
      onDone();
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
    <form onSubmit={onSubmit} className="space-y-4">
      {formError && <Alert>{formError}</Alert>}
      <Input label="Reward" name="name" required minLength={2} maxLength={80} defaultValue={reward?.name} placeholder="Free coffee" error={errors.name} />
      <Input label="Description (optional)" name="description" maxLength={300} defaultValue={reward?.description ?? ""} error={errors.description} />
      <Input
        label="Points needed"
        name="pointsRequired"
        type="number"
        inputMode="numeric"
        min={1}
        max={program.stampsRequired}
        required
        defaultValue={reward?.pointsRequired ?? program.stampsRequired}
        hint={`Up to ${program.stampsRequired} (the number of stamps on the card)`}
        error={errors.pointsRequired}
      />
      <div className="flex justify-end">
        <Button type="submit" loading={loading}>
          {reward ? "Save" : "Add reward"}
        </Button>
      </div>
    </form>
  );
}

interface FormState {
  name: string;
  description: string;
  stampIcon: string;
  stampsRequired: number;
  minPurchaseAmount: string;
  startsAt: string;
  endsAt: string;
  eligibility: string;
  terms: string;
  status: ProgramStatus;
  dailyLimitPerCustomer: number;
  cooldownMinutes: number;
  rewardName: string;
}

function ProgramForm({
  businessId,
  businessName,
  logoUrl,
  program,
  onDone,
}: {
  businessId: string;
  businessName: string;
  logoUrl: string | null;
  program: Program | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [s, setS] = useState<FormState>({
    name: program?.name ?? "",
    description: program?.description ?? "",
    stampIcon: program?.stampIcon ?? "coffee",
    stampsRequired: program?.stampsRequired ?? 10,
    minPurchaseAmount: program?.minPurchaseAmount != null ? String(program.minPurchaseAmount) : "",
    startsAt: toDateInput(program?.startsAt ?? null),
    endsAt: toDateInput(program?.endsAt ?? null),
    eligibility: program?.eligibility ?? "",
    terms: program?.terms ?? "",
    status: program?.status ?? "active",
    dailyLimitPerCustomer: program?.dailyLimitPerCustomer ?? 1,
    cooldownMinutes: program?.cooldownMinutes ?? 0,
    rewardName: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ApiError | string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS((prev) => ({ ...prev, [k]: v }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      name: s.name.trim(),
      description: s.description.trim(),
      stampIcon: s.stampIcon,
      stampsRequired: Number(s.stampsRequired),
      minPurchaseAmount: s.minPurchaseAmount === "" ? null : Number(s.minPurchaseAmount),
      startsAt: s.startsAt ? new Date(`${s.startsAt}T00:00:00+05:30`).toISOString() : null,
      endsAt: s.endsAt ? new Date(`${s.endsAt}T23:59:59+05:30`).toISOString() : null,
      eligibility: s.eligibility.trim(),
      terms: s.terms.trim(),
      status: s.status,
      dailyLimitPerCustomer: Number(s.dailyLimitPerCustomer),
      cooldownMinutes: Number(s.cooldownMinutes),
    };
    if (!program) body.rewards = [{ name: s.rewardName.trim() || "Free reward", pointsRequired: Number(s.stampsRequired) }];
    setLoading(true);
    setErrors({});
    setFormError(null);
    try {
      await api(program ? `/api/businesses/${businessId}/programs/${program.id}` : `/api/businesses/${businessId}/programs`, {
        method: program ? "PATCH" : "POST",
        body,
      });
      await qc.invalidateQueries({ queryKey: ["programs", businessId] });
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.code === "PLAN_LIMIT_REACHED" ? err : err.message);
      } else setFormError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const previewRewards = program?.rewards.filter((r) => r.isActive) ?? [{ name: s.rewardName || "Free reward", pointsRequired: Number(s.stampsRequired) || 1 }];

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {formError instanceof ApiError ? <PlanLimitAlert error={formError} businessId={businessId} /> : formError && <Alert>{formError}</Alert>}
      <LoyaltyCard
        businessName={businessName}
        logoUrl={logoUrl}
        programName={s.name || "Your program"}
        stampIcon={s.stampIcon}
        stampsRequired={Math.max(1, Math.min(100, Number(s.stampsRequired) || 1))}
        points={Math.min(3, Math.max(0, (Number(s.stampsRequired) || 1) - 1))}
        rewards={previewRewards}
        customerName="Customer name"
      />
      <Input label="Program name" value={s.name} onChange={(e) => set("name", e.target.value)} required minLength={2} maxLength={80} placeholder="Coffee lovers card" error={errors.name} />
      <Textarea
        label="Description"
        value={s.description}
        onChange={(e) => set("description", e.target.value)}
        maxLength={500}
        placeholder="Buy 9 coffees, get the 10th free"
        error={errors.description}
      />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-zinc-700">Stamp icon</legend>
        <div className="flex flex-wrap gap-2">
          {STAMP_ICONS.map((icon) => (
            <button
              type="button"
              key={icon}
              onClick={() => set("stampIcon", icon)}
              aria-pressed={s.stampIcon === icon}
              aria-label={icon}
              className={cx(
                "flex size-11 items-center justify-center rounded-xl border text-xl transition",
                s.stampIcon === icon ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/30" : "border-zinc-200 bg-white hover:bg-zinc-50",
              )}
            >
              {stampEmoji(icon)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Stamps on the card"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          required
          value={s.stampsRequired}
          onChange={(e) => set("stampsRequired", Number(e.target.value))}
          error={errors.stampsRequired}
        />
        {!program && (
          <Input
            label="Reward when the card is full"
            value={s.rewardName}
            onChange={(e) => set("rewardName", e.target.value)}
            maxLength={80}
            placeholder="Free coffee"
            error={errors.rewards}
          />
        )}
        <Input
          label="Minimum purchase (₹, optional)"
          type="number"
          inputMode="numeric"
          min={0}
          value={s.minPurchaseAmount}
          onChange={(e) => set("minPurchaseAmount", e.target.value)}
          hint="Shown to customers; staff confirm it at the counter"
          error={errors.minPurchaseAmount}
        />
        <Select label="Status" value={s.status} onChange={(e) => set("status", e.target.value as ProgramStatus)} error={errors.status}>
          {PROGRAM_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st[0]!.toUpperCase() + st.slice(1)}
            </option>
          ))}
        </Select>
        <Input label="Starts on (optional)" type="date" value={s.startsAt} onChange={(e) => set("startsAt", e.target.value)} error={errors.startsAt} />
        <Input label="Ends on (optional)" type="date" value={s.endsAt} onChange={(e) => set("endsAt", e.target.value)} error={errors.endsAt} />
        <Input
          label="Points per customer per day"
          type="number"
          min={1}
          max={20}
          value={s.dailyLimitPerCustomer}
          onChange={(e) => set("dailyLimitPerCustomer", Number(e.target.value))}
          error={errors.dailyLimitPerCustomer}
        />
        <Input
          label="Wait between points (minutes)"
          type="number"
          min={0}
          max={1440}
          value={s.cooldownMinutes}
          onChange={(e) => set("cooldownMinutes", Number(e.target.value))}
          error={errors.cooldownMinutes}
        />
      </div>
      <Textarea label="Who can join (optional)" value={s.eligibility} onChange={(e) => set("eligibility", e.target.value)} maxLength={500} error={errors.eligibility} />
      <Textarea label="Terms & conditions (optional)" value={s.terms} onChange={(e) => set("terms", e.target.value)} maxLength={2000} rows={4} error={errors.terms} />
      <div className="flex justify-end">
        <Button type="submit" loading={loading}>
          {program ? "Save changes" : "Create program"}
        </Button>
      </div>
    </form>
  );
}
