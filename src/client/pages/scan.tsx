import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Business, type Location } from "../lib/api";
import {
  friendlyError,
  newIdempotencyKey,
  stampEmoji,
  type IssueResult,
  type NfcRequestRow,
  type RedeemResult,
  type StaffCardSummary,
} from "../lib/loyalty-api";
import { CARD_TOKEN_PREFIX } from "../../shared/domain";
import { Alert, Badge, Button, Card, cx, EmptyState, Input, PageHeader, Select, Spinner } from "../components/ui";
import { QrScanner } from "../components/QrScanner";
import { useBusinessContext } from "./business";

type BusinessWithChannels = Business & { qrEnabled?: boolean; nfcTagEnabled?: boolean };
type Tab = "scan" | "phone" | "nfc";

type Outcome =
  | { kind: "issued"; result: IssueResult }
  | { kind: "redeemed"; result: RedeemResult }
  | { kind: "error"; message: string };

function OutcomePanel({ outcome, onNext }: { outcome: Outcome; onNext: () => void }) {
  return (
    <div className="space-y-4 text-center">
      {outcome.kind === "issued" && (
        <div className="rounded-2xl bg-emerald-50 p-6">
          <p className="text-4xl">✅</p>
          <p className="mt-2 text-lg font-semibold text-emerald-900">Point added for {outcome.result.customer.name}</p>
          <p className="mt-1 text-emerald-800">
            Now {outcome.result.pointsBalance} of {outcome.result.stampsRequired}
          </p>
          {outcome.result.unlockedRewards.length > 0 && (
            <div className="mt-4 rounded-xl bg-white p-3 text-emerald-900 shadow-sm">
              <p className="text-2xl">🎉</p>
              <p className="font-semibold">Reward unlocked: {outcome.result.unlockedRewards.map((r) => r.name).join(", ")}</p>
              <p className="text-sm text-emerald-700">The customer can redeem it now or on a later visit.</p>
            </div>
          )}
        </div>
      )}
      {outcome.kind === "redeemed" && (
        <div className="rounded-2xl bg-brand-50 p-6">
          <p className="text-4xl">🎁</p>
          <p className="mt-2 text-lg font-semibold text-brand-700">
            {outcome.result.reward.name} redeemed for {outcome.result.customer.name}
          </p>
          <p className="mt-1 text-brand-700">{outcome.result.pointsBalance} points left</p>
        </div>
      )}
      {outcome.kind === "error" && (
        <div className="rounded-2xl bg-red-50 p-6">
          <p className="text-4xl">⚠️</p>
          <p className="mt-2 font-medium text-red-800">{outcome.message}</p>
        </div>
      )}
      <Button className="h-12 w-full text-base" onClick={onNext}>
        Next customer
      </Button>
    </div>
  );
}

function RewardPicker({
  card,
  onRedeem,
  pending,
}: {
  card: StaffCardSummary;
  onRedeem: (rewardId: string) => void;
  pending: string | null;
}) {
  if (!card.rewards.length) return <p className="text-sm text-zinc-500">This program has no active rewards.</p>;
  return (
    <ul className="space-y-2">
      {card.rewards.map((r) => (
        <li key={r.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{r.name}</p>
            <p className="text-xs text-zinc-500">{r.pointsRequired} points</p>
          </div>
          <Button size="sm" disabled={!r.redeemable} loading={pending === r.id} onClick={() => onRedeem(r.id)}>
            {r.redeemable ? "Redeem" : `Needs ${r.pointsRequired - card.pointsBalance} more`}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ScanPage() {
  const { business: rawBusiness, membership } = useBusinessContext();
  const business = rawBusiness as BusinessWithChannels;
  const canIssue = membership.permissions.includes("points.issue");
  const canRedeem = membership.permissions.includes("rewards.redeem");
  const nfcOn = !!business.nfcTagEnabled && canIssue;
  const [tab, setTab] = useState<Tab>("scan");
  const locations = useQuery({
    queryKey: ["locations", business.id],
    queryFn: () => api<{ locations: Location[] }>(`/api/businesses/${business.id}/locations`),
    enabled: !membership.locationId,
  });
  const [locationId, setLocationId] = useState<string>(() => {
    try {
      return localStorage.getItem(`scan-location:${business.id}`) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`scan-location:${business.id}`, locationId);
    } catch {
      /* storage unavailable */
    }
  }, [business.id, locationId]);
  const activeLocations = (locations.data?.locations ?? []).filter((l) => l.isActive);
  const effectiveLocation = membership.locationId ?? (activeLocations.some((l) => l.id === locationId) ? locationId : null);

  const tabs: { id: Tab; label: string }[] = [
    { id: "scan", label: "Scan card" },
    { id: "phone", label: "Find by phone" },
    ...(nfcOn ? [{ id: "nfc" as const, label: "NFC requests" }] : []),
  ];

  return (
    <>
      <PageHeader title="Scan & Issue" description="Add points and redeem rewards at the counter" />
      {!membership.locationId && activeLocations.length > 1 && (
        <div className="mb-4 max-w-xs">
          <Select label="Counter location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Not specified</option>
            {activeLocations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="mb-5 flex gap-1 rounded-xl bg-zinc-100 p-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "h-10 flex-1 rounded-lg text-sm font-medium transition",
              tab === t.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mx-auto max-w-lg">
        {tab === "scan" && <ScanTab businessId={business.id} locationId={effectiveLocation} canIssue={canIssue} canRedeem={canRedeem} qrEnabled={business.qrEnabled !== false} />}
        {tab === "phone" && <PhoneTab businessId={business.id} locationId={effectiveLocation} canIssue={canIssue} canRedeem={canRedeem} />}
        {tab === "nfc" && nfcOn && <NfcTab businessId={business.id} />}
      </div>
    </>
  );
}

function ScanTab({
  businessId,
  locationId,
  canIssue,
  canRedeem,
  qrEnabled,
}: {
  businessId: string;
  locationId: string | null;
  canIssue: boolean;
  canRedeem: boolean;
  qrEnabled: boolean;
}) {
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [redeemCard, setRedeemCard] = useState<StaffCardSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const redeemKey = useRef<string>(newIdempotencyKey());

  const onScan = useCallback((text: string) => {
    if (!text.startsWith(CARD_TOKEN_PREFIX)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setToken(text);
    if ("vibrate" in navigator) navigator.vibrate?.(60);
  }, []);

  function reset() {
    setToken(null);
    setOutcome(null);
    setRedeemCard(null);
    setBusy(null);
    setInvalid(false);
    redeemKey.current = newIdempotencyKey();
  }

  async function addPoint() {
    if (!token) return;
    setBusy("issue");
    try {
      const { result } = await api<{ result: IssueResult }>(`/api/businesses/${businessId}/issue/scan`, { body: { token, locationId } });
      setOutcome({ kind: "issued", result });
      qc.invalidateQueries({ queryKey: ["redemptions", businessId] });
    } catch (e) {
      setOutcome({ kind: "error", message: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function startRedeem() {
    if (!token) return;
    setBusy("resolve");
    try {
      const { card } = await api<{ card: StaffCardSummary }>(`/api/businesses/${businessId}/cards/resolve`, { body: { token } });
      setRedeemCard(card);
    } catch (e) {
      setOutcome({ kind: "error", message: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  async function redeem(rewardId: string) {
    if (!redeemCard) return;
    setBusy(rewardId);
    try {
      const { result } = await api<{ result: RedeemResult }>(`/api/businesses/${businessId}/cards/${redeemCard.id}/redeem`, {
        body: { rewardId, idempotencyKey: redeemKey.current, locationId },
      });
      setOutcome({ kind: "redeemed", result });
      qc.invalidateQueries({ queryKey: ["redemptions", businessId] });
    } catch (e) {
      setOutcome({ kind: "error", message: friendlyError(e) });
    } finally {
      setBusy(null);
    }
  }

  function onManual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("code")).trim();
    if (v) onScan(v.startsWith(CARD_TOKEN_PREFIX) ? v : `${CARD_TOKEN_PREFIX}${v}`);
  }

  if (!qrEnabled && canIssue) {
    return <Alert tone="warning">QR point collection is turned off. An owner can turn it on in QR & NFC settings. You can still use “Find by phone”.</Alert>;
  }

  return (
    <div className="space-y-4">
      {outcome ? (
        <OutcomePanel outcome={outcome} onNext={reset} />
      ) : token ? (
        <Card>
          {redeemCard ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{redeemCard.customer.name}</p>
                  <p className="text-sm text-zinc-500">
                    {redeemCard.program.name} · {stampEmoji(redeemCard.program.stampIcon)} {redeemCard.pointsBalance} points
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={reset}>
                  Cancel
                </Button>
              </div>
              <RewardPicker card={redeemCard} onRedeem={redeem} pending={busy} />
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-center text-sm text-zinc-600">Card scanned. What would you like to do?</p>
              {canIssue && (
                <Button className="h-14 w-full text-base" loading={busy === "issue"} disabled={!!busy} onClick={addPoint}>
                  Add 1 point
                </Button>
              )}
              {canRedeem && (
                <Button variant="secondary" className="h-14 w-full text-base" loading={busy === "resolve"} disabled={!!busy} onClick={startRedeem}>
                  Redeem reward
                </Button>
              )}
              <Button variant="ghost" className="w-full" onClick={reset}>
                Scan again
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <>
          <QrScanner active={!token && !outcome} onResult={onScan} />
          {invalid && <Alert tone="warning">That QR code isn't a loyalty card. Ask the customer to open their card.</Alert>}
          <p className="text-center text-sm text-zinc-500">Point the camera at the QR code on the customer's card.</p>
          {manual ? (
            <form onSubmit={onManual} className="flex gap-2">
              <Input name="code" placeholder="Paste the card code" autoComplete="off" className="flex-1" />
              <Button type="submit">Use</Button>
            </form>
          ) : (
            <button className="mx-auto block text-sm text-brand-600 hover:underline" onClick={() => setManual(true)}>
              Camera not working? Enter the code
            </button>
          )}
        </>
      )}
    </div>
  );
}

function PhoneTab({ businessId, locationId, canIssue, canRedeem }: { businessId: string; locationId: string | null; canIssue: boolean; canRedeem: boolean }) {
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [redeemFor, setRedeemFor] = useState<StaffCardSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pendingKeys = useRef(new Map<string, string>());

  const lookup = useQuery({
    queryKey: ["lookup", businessId, submitted],
    queryFn: () => api<{ cards: StaffCardSummary[] }>(`/api/businesses/${businessId}/lookup?phone=${encodeURIComponent(submitted!)}`),
    enabled: !!submitted,
    staleTime: 0,
  });

  // A key is created on first press and reused until that action finishes, so a double tap can't issue twice.
  function keyFor(action: string) {
    let k = pendingKeys.current.get(action);
    if (!k) {
      k = newIdempotencyKey();
      pendingKeys.current.set(action, k);
    }
    return k;
  }

  const issue = useMutation({
    mutationFn: (cardId: string) =>
      api<{ result: IssueResult }>(`/api/businesses/${businessId}/cards/${cardId}/points`, {
        body: { idempotencyKey: keyFor(`issue:${cardId}`), locationId },
      }),
    onSuccess: ({ result }) => setOutcome({ kind: "issued", result }),
    onError: (e) => setOutcome({ kind: "error", message: friendlyError(e) }),
    onSettled: (_d, _e, cardId) => pendingKeys.current.delete(`issue:${cardId}`),
  });

  async function redeem(card: StaffCardSummary, rewardId: string) {
    const action = `redeem:${card.id}:${rewardId}`;
    setBusy(rewardId);
    try {
      const { result } = await api<{ result: RedeemResult }>(`/api/businesses/${businessId}/cards/${card.id}/redeem`, {
        body: { rewardId, idempotencyKey: keyFor(action), locationId },
      });
      setOutcome({ kind: "redeemed", result });
    } catch (e) {
      setOutcome({ kind: "error", message: friendlyError(e) });
    } finally {
      pendingKeys.current.delete(action);
      setBusy(null);
    }
  }

  function done() {
    setOutcome(null);
    setRedeemFor(null);
    lookup.refetch();
  }

  if (outcome) return <OutcomePanel outcome={outcome} onNext={done} />;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(phone.trim());
        }}
        className="flex gap-2"
      >
        <Input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="Customer mobile number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="h-12 flex-1 text-base"
          aria-label="Customer mobile number"
        />
        <Button type="submit" className="h-12" disabled={phone.trim().length < 10}>
          Find
        </Button>
      </form>
      {lookup.isFetching && (
        <div className="flex justify-center py-6 text-zinc-400">
          <Spinner />
        </div>
      )}
      {lookup.error && <Alert>{lookup.error instanceof ApiError ? lookup.error.message : "Search failed"}</Alert>}
      {lookup.data && !lookup.isFetching && !lookup.data.cards.length && (
        <EmptyState title="No card found" description="Ask the customer to scan your QR poster to join, then try again." />
      )}
      {lookup.data?.cards.map((card) => (
        <Card key={card.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold">{card.customer.name}</p>
              <p className="text-sm text-zinc-500">{card.program.name}</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tabular-nums">{card.pointsBalance}</p>
              <p className="text-xs text-zinc-500">of {card.program.stampsRequired}</p>
            </div>
          </div>
          {card.status === "blocked" && (
            <div className="mt-3">
              <Badge tone="danger">Card blocked</Badge>
            </div>
          )}
          {redeemFor?.id === card.id ? (
            <div className="mt-4 space-y-3">
              <RewardPicker card={card} onRedeem={(rid) => redeem(card, rid)} pending={busy} />
              <Button variant="ghost" className="w-full" onClick={() => setRedeemFor(null)}>
                Back
              </Button>
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {canIssue && (
                <Button className="h-12" loading={issue.isPending && issue.variables === card.id} disabled={issue.isPending} onClick={() => issue.mutate(card.id)}>
                  Add 1 point
                </Button>
              )}
              {canRedeem && (
                <Button variant="secondary" className="h-12" onClick={() => setRedeemFor(card)}>
                  Redeem reward
                </Button>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

function NfcTab({ businessId }: { businessId: string }) {
  const visible = usePageVisible();
  const now = useNow(1000);
  const [flash, setFlash] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const requests = useQuery({
    queryKey: ["nfc-requests", businessId],
    queryFn: () => api<{ requests: NfcRequestRow[] }>(`/api/businesses/${businessId}/nfc-requests`),
    refetchInterval: visible ? 4000 : false,
    staleTime: 0,
  });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) =>
      api<{ result?: IssueResult }>(`/api/businesses/${businessId}/nfc-requests/${id}/${decision}`, { method: "POST" }),
    onSuccess: (res, vars) => {
      setFlash(
        vars.decision === "approve" && res.result
          ? {
              tone: "success",
              text: `Point added for ${res.result.customer.name} (${res.result.pointsBalance}/${res.result.stampsRequired})${
                res.result.unlockedRewards.length ? ` — 🎉 ${res.result.unlockedRewards.map((r) => r.name).join(", ")} unlocked` : ""
              }`,
            }
          : { tone: "success", text: "Request rejected" },
      );
      requests.refetch();
    },
    onError: (e) => {
      setFlash({ tone: "error", text: friendlyError(e) });
      requests.refetch();
    },
  });

  const rows = (requests.data?.requests ?? []).filter((r) => new Date(r.expiresAt).getTime() > now);

  return (
    <div className="space-y-4">
      <Alert tone="info">Approve only when the 4-digit code matches the one on the customer's phone screen.</Alert>
      {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}
      {requests.isLoading ? (
        <div className="flex justify-center py-6 text-zinc-400">
          <Spinner />
        </div>
      ) : !rows.length ? (
        <EmptyState title="No pending taps" description="New requests appear here automatically when a customer taps your NFC tag." />
      ) : (
        rows.map((r) => {
          const left = Math.max(0, Math.round((new Date(r.expiresAt).getTime() - now) / 1000));
          return (
            <Card key={r.id}>
              <div className="flex items-center gap-4">
                <div className="rounded-xl bg-brand-50 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide text-brand-700">Code</p>
                  <p className="font-mono text-2xl font-bold tracking-widest text-brand-700">{r.shortCode}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{r.customerName}</p>
                  <p className="text-xs text-zinc-500">
                    {r.tagLabel ?? "NFC tag"} · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  className="h-12"
                  disabled={decide.isPending}
                  loading={decide.isPending && decide.variables?.id === r.id && decide.variables.decision === "reject"}
                  onClick={() => decide.mutate({ id: r.id, decision: "reject" })}
                >
                  Reject
                </Button>
                <Button
                  className="h-12"
                  disabled={decide.isPending}
                  loading={decide.isPending && decide.variables?.id === r.id && decide.variables.decision === "approve"}
                  onClick={() => decide.mutate({ id: r.id, decision: "approve" })}
                >
                  Approve
                </Button>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
