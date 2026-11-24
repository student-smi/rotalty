import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { STAMP_ICONS, stampEmoji, type Program } from "../lib/loyalty-api";
import { TEMPLATES } from "../lib/card-templates";
import { CATEGORY_LABELS } from "../lib/labels";
import { BUSINESS_CATEGORIES } from "../../shared/permissions";
import type { ProgramStatus } from "../../shared/domain";
import { Alert, Button, cx, Input, Textarea } from "../components/ui";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { JoinButtonPreview, ProgramOffer, ShopHeader } from "../components/ShopPage";
import { AdvancedSection, EditorLayout, EditorSection, PhoneFrame, SaveBar, Segmented, sameJson, useUnsavedChangesGuard } from "../components/editor";
import { useBusinessContext } from "./business";
import { EditorSkeleton } from "../components/skeletons";

interface RewardRow {
  key: string;
  id?: string;
  name: string;
  description: string;
  pointsRequired: number;
  isActive: boolean;
}

interface Form {
  name: string;
  description: string;
  stampIcon: string;
  stampsRequired: number;
  status: ProgramStatus;
  rewards: RewardRow[];
  minPurchaseAmount: string;
  startsAt: string;
  endsAt: string;
  dailyLimitPerCustomer: number;
  cooldownMinutes: number;
  eligibility: string;
  terms: string;
}

const STATUS_OPTIONS: { value: ProgramStatus; label: string; hint: string }[] = [
  { value: "active", label: "Active", hint: "Customers can join and collect stamps" },
  { value: "paused", label: "Paused", hint: "No new stamps; earned rewards can still be redeemed" },
  { value: "draft", label: "Draft", hint: "Hidden from customers while you set it up" },
  { value: "archived", label: "Ended", hint: "Program is over and hidden from new customers" },
];

const toDateInput = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
const newKey = () => Math.random().toString(36).slice(2);

function fromProgram(p: Program | null, category: keyof typeof TEMPLATES): Form {
  if (!p) {
    const t = TEMPLATES[category] ?? TEMPLATES.other;
    return {
      name: t.programName,
      description: "",
      stampIcon: t.icon,
      stampsRequired: t.stamps,
      status: "active",
      rewards: [{ key: newKey(), name: t.reward, description: "", pointsRequired: t.stamps, isActive: true }],
      minPurchaseAmount: "",
      startsAt: "",
      endsAt: "",
      dailyLimitPerCustomer: 1,
      cooldownMinutes: 0,
      eligibility: "",
      terms: "",
    };
  }
  return {
    name: p.name,
    description: p.description ?? "",
    stampIcon: p.stampIcon,
    stampsRequired: p.stampsRequired,
    status: p.status,
    rewards: p.rewards.map((r) => ({ key: r.id, id: r.id, name: r.name, description: r.description ?? "", pointsRequired: r.pointsRequired, isActive: r.isActive })),
    minPurchaseAmount: p.minPurchaseAmount != null ? String(p.minPurchaseAmount) : "",
    startsAt: toDateInput(p.startsAt),
    endsAt: toDateInput(p.endsAt),
    dailyLimitPerCustomer: p.dailyLimitPerCustomer,
    cooldownMinutes: p.cooldownMinutes,
    eligibility: p.eligibility ?? "",
    terms: p.terms ?? "",
  };
}

function validate(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.name = "Give your card a name";
  if (!Number.isInteger(f.stampsRequired) || f.stampsRequired < 1 || f.stampsRequired > 100) e.stampsRequired = "Use 1 to 100 stamps";
  if (!f.rewards.some((r) => r.isActive)) e.rewards = "Add at least one reward";
  f.rewards.forEach((r) => {
    if (r.name.trim().length < 2) e[`reward-${r.key}`] = "Name the reward";
    else if (r.pointsRequired < 1 || r.pointsRequired > f.stampsRequired) e[`reward-${r.key}`] = `Needs 1 to ${f.stampsRequired} stamps`;
  });
  if (f.startsAt && f.endsAt && f.endsAt <= f.startsAt) e.endsAt = "End date must be after the start date";
  return e;
}

export function ProgramEditorPage() {
  const { business } = useBusinessContext();
  const { programId } = useParams();
  const isNew = !programId;
  const programs = useQuery({
    queryKey: ["programs", business.id],
    queryFn: () => api<{ programs: Program[] }>(`/api/businesses/${business.id}/programs`),
    enabled: !isNew,
  });
  const program = isNew ? null : programs.data?.programs.find((p) => p.id === programId);

  if (!isNew && programs.isLoading) return <EditorSkeleton />;
  if (!isNew && !program) return <Alert>We couldn't find this loyalty card.</Alert>;
  return <Editor key={programId ?? "new"} program={program ?? null} />;
}

function Editor({ program }: { program: Program | null }) {
  const { business } = useBusinessContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const base = `/api/businesses/${business.id}`;
  const initial = useMemo(() => fromProgram(program, business.category), [program, business.category]);
  const [f, setF] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | string | null>(null);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewTab, setPreviewTab] = useState<"card" | "join">("card");
  const [previewState, setPreviewState] = useState<"new" | "half" | "ready">("half");
  const dirty = !sameJson(f, initial) || !program;
  useUnsavedChangesGuard(dirty && !saving && !!program);

  // After saving, reload the form from the server (new rewards get real ids) so "unsaved" clears.
  const resync = useRef(false);
  useEffect(() => {
    if (!resync.current) return;
    resync.current = false;
    setF(initial);
  }, [initial]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const errors = touched ? validate(f) : {};

  const setReward = (key: string, patch: Partial<RewardRow>) => setF((p) => ({ ...p, rewards: p.rewards.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));

  function applyTemplate(cat: keyof typeof TEMPLATES) {
    const t = TEMPLATES[cat];
    setF((p) => ({
      ...p,
      name: t.programName,
      stampIcon: t.icon,
      stampsRequired: t.stamps,
      rewards: [{ key: newKey(), name: t.reward, description: "", pointsRequired: t.stamps, isActive: true }],
    }));
  }

  const activeRewards = f.rewards.filter((r) => r.isActive && r.name.trim());
  const stamps = Math.max(1, Math.min(100, f.stampsRequired || 1));
  const firstReward = [...activeRewards].sort((a, b) => a.pointsRequired - b.pointsRequired)[0];
  const suggestion = firstReward ? `Collect ${stamps} stamps, get ${firstReward.name.trim().replace(/^./, (c) => c.toLowerCase())}.` : "";
  const previewPoints = previewState === "new" ? 0 : previewState === "ready" ? stamps : Math.max(1, Math.floor(stamps / 2));

  async function save() {
    setTouched(true);
    const v = validate(f);
    if (Object.keys(v).length) {
      setError("Please fix the highlighted fields.");
      return;
    }
    setSaving(true);
    setError(null);
    const programBody = {
      name: f.name.trim(),
      description: f.description.trim(),
      stampIcon: f.stampIcon,
      stampsRequired: stamps,
      status: f.status,
      minPurchaseAmount: f.minPurchaseAmount === "" ? null : Number(f.minPurchaseAmount),
      startsAt: f.startsAt ? new Date(`${f.startsAt}T00:00:00+05:30`).toISOString() : null,
      endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59+05:30`).toISOString() : null,
      dailyLimitPerCustomer: Number(f.dailyLimitPerCustomer),
      cooldownMinutes: Number(f.cooldownMinutes),
      eligibility: f.eligibility.trim(),
      terms: f.terms.trim(),
    };
    const rewardBody = (r: RewardRow) => ({ name: r.name.trim(), description: r.description.trim(), pointsRequired: r.pointsRequired, isActive: r.isActive });
    try {
      if (!program) {
        const { program: created } = await api<{ program: Program }>(`${base}/programs`, {
          body: { ...programBody, rewards: f.rewards.filter((r) => r.isActive).map(rewardBody) },
        });
        await qc.invalidateQueries({ queryKey: ["programs", business.id] });
        navigate(`/app/b/${business.id}/loyalty/${created.id}`, { replace: true });
        return;
      }
      // Rewards must always fit the card: shrink rewards before the card, or grow the card before rewards.
      const rewardCalls = async () => {
        for (const r of f.rewards) {
          const old = program.rewards.find((x) => x.id === r.id);
          if (!r.id) {
            if (r.name.trim()) await api(`${base}/programs/${program.id}/rewards`, { body: rewardBody(r) });
          } else if (old && !sameJson(rewardBody(r), { name: old.name, description: old.description ?? "", pointsRequired: old.pointsRequired, isActive: old.isActive })) {
            await api(`${base}/rewards/${r.id}`, { method: "PATCH", body: rewardBody(r) });
          }
        }
      };
      const programChanged = !sameJson({ ...initial, rewards: [] }, { ...f, rewards: [] });
      if (stamps >= program.stampsRequired) {
        if (programChanged) await api(`${base}/programs/${program.id}`, { method: "PATCH", body: programBody });
        await rewardCalls();
      } else {
        await rewardCalls();
        if (programChanged) await api(`${base}/programs/${program.id}`, { method: "PATCH", body: programBody });
      }
      resync.current = true;
      await qc.invalidateQueries({ queryKey: ["programs", business.id] });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === "PLAN_LIMIT_REACHED" ? err : err.message) : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const preview = (
    <>
      <PhoneFrame>
        {previewTab === "card" ? (
          <div className="pt-2">
            <p className="mb-3 text-sm font-semibold text-zinc-500">← My cards</p>
            <LoyaltyCard
              businessName={business.name}
              logoUrl={business.logoUrl}
              programName={f.name || "Your card name"}
              customerName="Riya Shah"
              stampIcon={f.stampIcon}
              stampsRequired={stamps}
              points={previewPoints}
              rewards={activeRewards}
            />
            {previewState === "ready" && firstReward && (
              <div className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="font-semibold">🎉 Ready to redeem: {activeRewards.filter((r) => r.pointsRequired <= previewPoints).map((r) => r.name).join(", ")}</p>
                <p className="text-xs">Show the QR below to staff to claim it.</p>
              </div>
            )}
            <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold">Rewards</p>
              <ul className="mt-2 space-y-2">
                {[...activeRewards]
                  .sort((a, b) => a.pointsRequired - b.pointsRequired)
                  .map((r) => {
                    const unlocked = previewPoints >= r.pointsRequired;
                    return (
                      <li key={r.key} className="flex items-center gap-2.5 text-sm">
                        <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", unlocked ? "bg-emerald-500 text-white" : "bg-zinc-100 text-zinc-600")}>
                          {unlocked ? "✓" : r.pointsRequired}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.name}</span>
                          <span className="block text-xs text-zinc-500">{unlocked ? "Ready to redeem" : `${r.pointsRequired - previewPoints} more to go`}</span>
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-5 pt-2">
            <ShopHeader shop={business} />
            <ProgramOffer
              program={{
                name: f.name,
                description: f.description || null,
                stampIcon: f.stampIcon,
                stampsRequired: stamps,
                minPurchaseAmount: f.minPurchaseAmount ? Number(f.minPurchaseAmount) : null,
                endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59+05:30`).toISOString() : null,
                eligibility: f.eligibility || null,
                terms: f.terms || null,
                rewards: activeRewards,
              }}
              action={<JoinButtonPreview />}
            />
          </div>
        )}
      </PhoneFrame>
      <Segmented
        label="Preview screen"
        value={previewTab}
        onChange={setPreviewTab}
        options={[
          { value: "card", label: "Customer's card" },
          { value: "join", label: "Join page" },
        ]}
      />
      {previewTab === "card" && (
        <Segmented
          label="Customer progress"
          value={previewState}
          onChange={setPreviewState}
          options={[
            { value: "new", label: "New" },
            { value: "half", label: "Halfway" },
            { value: "ready", label: "Reward ready" },
          ]}
        />
      )}
    </>
  );

  return (
    <EditorLayout
      back={{ to: `/app/b/${business.id}/loyalty`, label: "Stamp cards" }}
      title={program ? `Edit “${program.name}”` : "New stamp card"}
      subtitle="Changes show up on the right as you type."
      preview={preview}
      footer={
        <SaveBar
          dirty={dirty}
          saving={saving}
          saved={saved && !dirty}
          onSave={save}
          onDiscard={program ? () => setF(initial) : undefined}
          saveLabel={program ? "Save changes" : "Create stamp card"}
          error={
            error instanceof ApiError ? (
              <Alert tone="warning">
                {error.message}{" "}
                <Link to={`/app/b/${business.id}/subscription`} className="font-medium underline">
                  View plans
                </Link>
              </Alert>
            ) : (
              error ?? undefined
            )
          }
        />
      }
    >
      {!program && (
        <EditorSection title="Start from a ready-made card" hint="Pick the closest one; you can change everything below.">
          <div className="flex flex-wrap gap-2">
            {[business.category, ...BUSINESS_CATEGORIES.filter((c) => c !== business.category)].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => applyTemplate(c)}
                className={cx(
                  "rounded-full border px-3 py-1.5 text-sm transition",
                  f.name === TEMPLATES[c].programName ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-zinc-300 bg-white text-zinc-700 hover:border-brand-400",
                )}
              >
                {stampEmoji(TEMPLATES[c].icon)} {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </EditorSection>
      )}

      <EditorSection n={1} title="Name your card" hint="Customers see this on their phone.">
        <div className="space-y-4">
          <Input label="Card name" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={80} placeholder="e.g. Coffee lover card" error={errors.name} />
          <div>
            <Textarea
              label="Short description (optional)"
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
              maxLength={500}
              rows={2}
              placeholder={suggestion || "Buy 9 coffees, get the 10th free"}
            />
            {!f.description && suggestion && (
              <button type="button" onClick={() => set("description", suggestion)} className="mt-1.5 text-sm font-medium text-brand-600 hover:underline">
                Use “{suggestion}”
              </button>
            )}
          </div>
        </div>
      </EditorSection>

      <EditorSection n={2} title="How many stamps?" hint="One stamp per visit. Fewer stamps = customers come back sooner for the reward.">
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={30}
            value={Math.min(stamps, 30)}
            onChange={(e) => set("stampsRequired", Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer accent-brand-500"
            aria-label="Stamps on the card"
          />
          <input
            type="number"
            min={1}
            max={100}
            value={f.stampsRequired}
            onChange={(e) => set("stampsRequired", Number(e.target.value))}
            className="h-11 w-20 rounded-lg border border-zinc-300 text-center text-lg font-semibold tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            aria-label="Stamps (number)"
          />
        </div>
        {errors.stampsRequired && <p className="mt-1.5 text-sm text-red-600">{errors.stampsRequired}</p>}
        <p className="mb-2 mt-5 text-sm font-medium text-zinc-700">Stamp icon</p>
        <div className="flex flex-wrap gap-2">
          {STAMP_ICONS.map((icon) => (
            <button
              type="button"
              key={icon}
              onClick={() => set("stampIcon", icon)}
              aria-pressed={f.stampIcon === icon}
              aria-label={icon}
              className={cx(
                "flex size-11 items-center justify-center rounded-xl border text-xl transition",
                f.stampIcon === icon ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/30" : "border-zinc-200 bg-white hover:bg-zinc-50",
              )}
            >
              {stampEmoji(icon)}
            </button>
          ))}
        </div>
      </EditorSection>

      <EditorSection n={3} title="Rewards" hint="What customers get. Add a smaller reward halfway to keep them interested.">
        {errors.rewards && (
          <div className="mb-3">
            <Alert>{errors.rewards}</Alert>
          </div>
        )}
        <ul className="space-y-3">
          {f.rewards.map((r) => (
              <li key={r.key} className={cx("rounded-xl border border-zinc-200 p-3", !r.isActive && "bg-zinc-50 opacity-70")}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-[10rem] flex-1">
                    <Input label="Reward" value={r.name} onChange={(e) => setReward(r.key, { name: e.target.value })} maxLength={80} placeholder="e.g. Free coffee" />
                  </div>
                  <div className="w-28">
                    <Input
                      label="After stamps"
                      type="number"
                      min={1}
                      max={stamps}
                      value={r.pointsRequired}
                      onChange={(e) => setReward(r.key, { pointsRequired: Number(e.target.value) })}
                    />
                  </div>
                </div>
                {errors[`reward-${r.key}`] && <p className="mt-1.5 text-sm text-red-600">{errors[`reward-${r.key}`]}</p>}
                <div className="mt-2 flex gap-3 text-sm">
                  {r.id ? (
                    <button type="button" onClick={() => setReward(r.key, { isActive: !r.isActive })} className="font-medium text-zinc-600 hover:underline">
                      {r.isActive ? "Turn off" : "Turn on again"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setF((p) => ({ ...p, rewards: p.rewards.filter((x) => x.key !== r.key) }))} className="font-medium text-red-600 hover:underline">
                      Remove
                    </button>
                  )}
                  {!r.isActive && <span className="text-zinc-500">Off: customers don't see this reward</span>}
                </div>
              </li>
            ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={f.rewards.length >= 10}
            onClick={() => setF((p) => ({ ...p, rewards: [...p.rewards, { key: newKey(), name: "", description: "", pointsRequired: stamps, isActive: true }] }))}
          >
            + Add reward
          </Button>
          {stamps >= 4 && !f.rewards.some((r) => r.pointsRequired === Math.floor(stamps / 2)) && (
            <Button
              variant="ghost"
              size="sm"
              disabled={f.rewards.length >= 10}
              onClick={() =>
                setF((p) => ({ ...p, rewards: [...p.rewards, { key: newKey(), name: "Small treat", description: "", pointsRequired: Math.floor(stamps / 2), isActive: true }] }))
              }
            >
              + Halfway reward ({Math.floor(stamps / 2)} stamps)
            </Button>
          )}
        </div>
      </EditorSection>

      <EditorSection n={4} title="Card status">
        <div className="grid gap-2 sm:grid-cols-2">
          {STATUS_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cx(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition",
                f.status === o.value ? "border-brand-500 bg-brand-50/60 ring-2 ring-brand-500/20" : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <input type="radio" name="status" className="mt-1 accent-brand-500" checked={f.status === o.value} onChange={() => set("status", o.value)} />
              <span className="text-sm">
                <span className="block font-medium text-zinc-900">{o.label}</span>
                <span className="block text-zinc-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </EditorSection>

      <AdvancedSection title="Rules & dates" hint="Minimum purchase, daily limit, dates and terms" defaultOpen={!!(f.minPurchaseAmount || f.startsAt || f.endsAt || f.terms || f.eligibility)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Minimum purchase (₹, optional)"
            type="number"
            inputMode="numeric"
            min={0}
            value={f.minPurchaseAmount}
            onChange={(e) => set("minPurchaseAmount", e.target.value)}
            hint="Shown to customers; staff confirm it at the counter"
          />
          <Input
            label="Stamps per customer per day"
            type="number"
            min={1}
            max={20}
            value={f.dailyLimitPerCustomer}
            onChange={(e) => set("dailyLimitPerCustomer", Number(e.target.value))}
          />
          <Input label="Starts on (optional)" type="date" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
          <Input label="Ends on (optional)" type="date" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} error={errors.endsAt} />
          <Input
            label="Wait between stamps (minutes)"
            type="number"
            min={0}
            max={1440}
            value={f.cooldownMinutes}
            onChange={(e) => set("cooldownMinutes", Number(e.target.value))}
            hint="Stops two stamps for one visit"
          />
        </div>
        <div className="mt-4 space-y-4">
          <Textarea label="Who can join (optional)" value={f.eligibility} onChange={(e) => set("eligibility", e.target.value)} maxLength={500} rows={2} />
          <Textarea label="Terms & conditions (optional)" value={f.terms} onChange={(e) => set("terms", e.target.value)} maxLength={2000} rows={3} />
        </div>
      </AdvancedSection>
    </EditorLayout>
  );
}
