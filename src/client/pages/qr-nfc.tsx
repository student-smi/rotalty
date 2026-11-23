import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Location } from "../lib/api";
import { formatDateTime, type ChannelsResponse, type NfcTagRow, type QrCodeRow } from "../lib/loyalty-api";
import { detectNfc, writeUrlToTag } from "../lib/nfc";
import { Alert, Badge, Button, Card, cx, EmptyState, Input, Modal, PageHeader, Select, Spinner } from "../components/ui";
import { downloadQrPng, downloadQrSvg, QrCode } from "../components/QrCode";
import { useBusinessContext } from "./business";

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand-500" : "bg-zinc-300",
      )}
    >
      <span className={cx("inline-block size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          prompt("Copy this link", text);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

export function QrNfcPage() {
  const { business } = useBusinessContext();
  const qc = useQueryClient();
  const base = `/api/businesses/${business.id}`;
  const key = ["channels", business.id];
  const channels = useQuery({ queryKey: key, queryFn: () => api<ChannelsResponse>(`${base}/channels`) });
  const locations = useQuery({ queryKey: ["locations", business.id], queryFn: () => api<{ locations: Location[] }>(`${base}/locations`) });
  const [toggleError, setToggleError] = useState<ApiError | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["business", business.id] });
  };

  const toggle = useMutation({
    mutationFn: (body: Partial<ChannelsResponse["settings"]>) => api(`${base}/channels`, { method: "PATCH", body }),
    onSuccess: () => {
      setToggleError(null);
      refresh();
    },
    onError: (e) => setToggleError(e instanceof ApiError ? e : new ApiError(0, "UNKNOWN", "Could not update")),
  });

  if (channels.isLoading) {
    return (
      <div className="flex justify-center py-12 text-zinc-400">
        <Spinner />
      </div>
    );
  }
  if (channels.error || !channels.data) return <Alert>Could not load QR & NFC settings.</Alert>;
  const data = channels.data;
  const locs = locations.data?.locations ?? [];
  const locationName = (id: string | null) => (id ? (locs.find((l) => l.id === id)?.name ?? "—") : "All locations");

  return (
    <>
      <PageHeader title="QR & NFC" description="How customers open your loyalty page and collect points" />
      <div className="space-y-6">
        <Card title="Collection methods">
          {toggleError && (
            <div className="mb-4">
              <Alert tone={toggleError.code === "PLAN_LIMIT_REACHED" ? "warning" : "error"}>
                {toggleError.message}{" "}
                {toggleError.code === "PLAN_LIMIT_REACHED" && (
                  <Link className="font-medium underline" to={`/app/b/${business.id}/subscription`}>
                    View plans
                  </Link>
                )}
              </Alert>
            </div>
          )}
          <ul className="divide-y divide-zinc-100">
            <li className="flex items-start gap-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium">QR code</p>
                <p className="text-sm text-zinc-500">Staff scan the rotating QR on the customer's card to add a point.</p>
              </div>
              <Toggle label="QR code" checked={data.settings.qrEnabled} disabled={toggle.isPending} onChange={(v) => toggle.mutate({ qrEnabled: v })} />
            </li>
            <li className="flex items-start gap-4 py-3">
              <div className="flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  NFC tags {!data.capabilities.nfcIncludedInPlan && <Badge tone="warning">Upgrade</Badge>}
                </p>
                <p className="text-sm text-zinc-500">
                  Customers tap a sticker at your counter; staff approve the request on the Scan page.
                </p>
              </div>
              <Toggle
                label="NFC tags"
                checked={data.settings.nfcTagEnabled}
                disabled={toggle.isPending}
                onChange={(v) => toggle.mutate({ nfcTagEnabled: v })}
              />
            </li>
            <li className="flex items-start gap-4 py-3">
              <div className="flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  Phone-to-phone NFC <Badge>Not available</Badge>
                </p>
                <p className="text-sm text-zinc-500">
                  {data.capabilities.nfcPhoneSupported
                    ? "Supported."
                    : "Web browsers can't make a phone act like an NFC card, so phone-to-phone taps need a native Android app. Use the card QR or NFC tags instead."}
                </p>
              </div>
              <Toggle label="Phone-to-phone NFC" checked={false} disabled onChange={() => undefined} />
            </li>
          </ul>
        </Card>

        <Card title="Your loyalty page" description="Share this link anywhere — WhatsApp, Instagram, Google profile">
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-50 px-3 py-2 text-sm">{data.businessPageUrl}</code>
            <CopyButton text={data.businessPageUrl} />
            <a href={data.businessPageUrl} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="ghost" type="button">
                Open
              </Button>
            </a>
          </div>
        </Card>

        <QrCodesCard base={base} businessName={business.name} codes={data.qrCodes} locations={locs} locationName={locationName} onChange={refresh} />
        <NfcTagsCard
          base={base}
          tags={data.nfcTags}
          locations={locs}
          locationName={locationName}
          enabled={data.settings.nfcTagEnabled}
          included={data.capabilities.nfcIncludedInPlan}
          businessId={business.id}
          onChange={refresh}
        />
        <NfcHistoryCard base={base} businessId={business.id} />
      </div>
    </>
  );
}

function LabelLocationForm({
  locations,
  submitLabel,
  onSubmit,
}: {
  locations: Location[];
  submitLabel: string;
  onSubmit: (body: { label: string; locationId: string | null }) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    try {
      await onSubmit({ label: String(f.get("label")).trim(), locationId: String(f.get("locationId")) || null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }
  return (
    <form onSubmit={handle} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Input label="Label" name="label" required minLength={2} maxLength={60} placeholder="Counter poster" />
      <Select label="Location" name="locationId" defaultValue="">
        <option value="">All locations</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </Select>
      <div className="flex justify-end">
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function QrCodesCard({
  base,
  businessName,
  codes,
  locations,
  locationName,
  onChange,
}: {
  base: string;
  businessName: string;
  codes: QrCodeRow[];
  locations: Location[];
  locationName: (id: string | null) => string;
  onChange: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "revoke" | "rotate" }) => api(`${base}/qr-codes/${id}/${kind}`, { method: "POST" }),
    onSuccess: onChange,
    onError: (e) => setError(e instanceof ApiError ? e.message : "Action failed"),
  });
  const visible = codes.filter((q) => showRevoked || q.status === "active");

  return (
    <Card
      title="Printed QR codes"
      description="Put these on your counter, menu or bill. Scanning opens your loyalty page — it never adds points by itself."
      actions={<Button size="sm" onClick={() => setCreating(true)}>New QR code</Button>}
    >
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {!visible.length ? (
        <EmptyState title="No QR codes yet" description="Create one for each counter or table so you can see which gets scanned most." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {visible.map((q) => (
            <li key={q.id} className={cx("rounded-xl border border-zinc-200 p-4", q.status === "revoked" && "opacity-60")}>
              <div className="flex gap-4">
                <QrCode value={q.url} size={112} label={q.label} className="rounded-lg border border-zinc-100" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{q.label}</span>
                    {q.status === "revoked" && <Badge tone="danger">Revoked</Badge>}
                  </p>
                  <p className="text-xs text-zinc-500">{locationName(q.locationId)}</p>
                  <p className="text-xs text-zinc-500">
                    {q.scanCount} scans · last {q.lastScannedAt ? formatDateTime(q.lastScannedAt) : "never"}
                  </p>
                  <p className="truncate text-xs text-zinc-400">{q.url}</p>
                </div>
              </div>
              {q.status === "active" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => downloadQrPng(q.url, q.label, businessName)}>
                    PNG
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => downloadQrSvg(q.url, q.label, businessName)}>
                    SVG
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={action.isPending && action.variables?.id === q.id && action.variables.kind === "rotate"}
                    onClick={() => {
                      if (confirm("Rotate this QR code? Posters printed with the old code will stop working.")) action.mutate({ id: q.id, kind: "rotate" });
                    }}
                  >
                    Rotate
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={action.isPending && action.variables?.id === q.id && action.variables.kind === "revoke"}
                    onClick={() => {
                      if (confirm("Revoke this QR code? It will stop working immediately.")) action.mutate({ id: q.id, kind: "revoke" });
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {codes.some((q) => q.status === "revoked") && (
        <button className="mt-3 text-sm text-brand-600 hover:underline" onClick={() => setShowRevoked((v) => !v)}>
          {showRevoked ? "Hide revoked" : "Show revoked"}
        </button>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New QR code">
        <LabelLocationForm
          locations={locations}
          submitLabel="Create"
          onSubmit={async (body) => {
            await api(`${base}/qr-codes`, { body });
            setCreating(false);
            onChange();
          }}
        />
      </Modal>
    </Card>
  );
}

function WriteTag({ url }: { url: string }) {
  const caps = detectNfc();
  const [state, setState] = useState<"idle" | "writing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!caps.webNfc) {
    return (
      <div className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
        <p className="font-medium text-zinc-800">How to write this tag</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5">
          <li>Install the free “NFC Tools” app on your phone.</li>
          <li>Choose Write → Add a record → URL/URI, and paste the link above.</li>
          <li>Hold an NTAG213/215 sticker to the back of the phone to write it.</li>
          <li>Optionally lock the tag afterwards so nobody can overwrite it.</li>
        </ol>
        <p className="mt-2 text-xs text-zinc-500">Writing directly from this page works in Chrome on Android.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {error && <Alert>{error}</Alert>}
      {state === "done" && <Alert tone="success">Tag written. Tap it with a phone to test, then lock it in the NFC Tools app if you like.</Alert>}
      <Button
        size="sm"
        loading={state === "writing"}
        onClick={async () => {
          setError(null);
          setState("writing");
          try {
            await writeUrlToTag(url);
            setState("done");
          } catch (e) {
            setError((e as Error).message);
            setState("idle");
          }
        }}
      >
        {state === "writing" ? "Hold the tag to your phone…" : "Write to tag"}
      </Button>
    </div>
  );
}

function NfcTagsCard({
  base,
  tags,
  locations,
  locationName,
  enabled,
  included,
  businessId,
  onChange,
}: {
  base: string;
  tags: NfcTagRow[];
  locations: Location[];
  locationName: (id: string | null) => string;
  enabled: boolean;
  included: boolean;
  businessId: string;
  onChange: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [writing, setWriting] = useState<NfcTagRow | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [showRevoked, setShowRevoked] = useState(false);
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: "revoke" | "replace" }) =>
      api<{ nfcTag?: { id: string; code: string; label: string; url: string } }>(`${base}/nfc-tags/${id}/${kind}`, { method: "POST" }),
    onSuccess: (res) => {
      onChange();
      if (res.nfcTag) {
        setWriting({ ...res.nfcTag, locationId: null, status: "active", replacedById: null, tapCount: 0, lastTapAt: null, createdAt: new Date().toISOString() });
      }
    },
    onError: (e) => setError(e instanceof ApiError ? e : null),
  });
  const visible = tags.filter((t) => showRevoked || t.status === "active");

  return (
    <Card
      title="NFC tags"
      description="A tag only opens your page. Each point still needs a staff member to approve it, so a copied tag can't be abused."
      actions={
        <Button size="sm" onClick={() => setCreating(true)} disabled={!included}>
          Register tag
        </Button>
      }
    >
      {!included && (
        <div className="mb-3">
          <Alert tone="warning">
            NFC tags aren't included in your plan.{" "}
            <Link className="font-medium underline" to={`/app/b/${businessId}/subscription`}>
              View plans
            </Link>
          </Alert>
        </div>
      )}
      {included && !enabled && tags.length > 0 && (
        <div className="mb-3">
          <Alert tone="info">NFC tags are turned off above, so taps currently show an “inactive” message.</Alert>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Alert>{error.message}</Alert>
        </div>
      )}
      {!visible.length ? (
        <EmptyState title="No NFC tags registered" description="Register a tag, then write its link onto an NFC sticker for your counter." />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {visible.map((t) => (
            <li key={t.id} className={cx("flex flex-wrap items-center gap-3 py-3", t.status === "revoked" && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {t.label}
                  {t.status === "revoked" && <Badge tone="danger">{t.replacedById ? "Replaced" : "Revoked"}</Badge>}
                </p>
                <p className="text-xs text-zinc-500">
                  {locationName(t.locationId)} · {t.tapCount} taps · last {t.lastTapAt ? formatDateTime(t.lastTapAt) : "never"}
                </p>
              </div>
              {t.status === "active" && (
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setWriting(t)}>
                    Link & write
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={action.isPending && action.variables?.id === t.id && action.variables.kind === "replace"}
                    onClick={() => {
                      if (confirm("Replace this tag? The old sticker stops working and you'll get a new link to write.")) action.mutate({ id: t.id, kind: "replace" });
                    }}
                  >
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={action.isPending && action.variables?.id === t.id && action.variables.kind === "revoke"}
                    onClick={() => {
                      if (confirm("Revoke this tag? It stops working immediately.")) action.mutate({ id: t.id, kind: "revoke" });
                    }}
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {tags.some((t) => t.status === "revoked") && (
        <button className="mt-3 text-sm text-brand-600 hover:underline" onClick={() => setShowRevoked((v) => !v)}>
          {showRevoked ? "Hide revoked" : "Show revoked"}
        </button>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Register NFC tag">
        <LabelLocationForm
          locations={locations}
          submitLabel="Register"
          onSubmit={async (body) => {
            const res = await api<{ nfcTag: { id: string; code: string; label: string; url: string } }>(`${base}/nfc-tags`, { body });
            setCreating(false);
            onChange();
            setWriting({ ...res.nfcTag, locationId: body.locationId, status: "active", replacedById: null, tapCount: 0, lastTapAt: null, createdAt: new Date().toISOString() });
          }}
        />
      </Modal>
      <Modal open={!!writing} onClose={() => setWriting(null)} title={writing ? `Write “${writing.label}”` : ""}>
        {writing && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">Write this link onto the NFC sticker as a URL record:</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-zinc-50 px-3 py-2 text-xs">{writing.url}</code>
              <CopyButton text={writing.url} />
            </div>
            <WriteTag url={writing.url} />
          </div>
        )}
      </Modal>
    </Card>
  );
}

interface NfcHistoryRow {
  id: string;
  channel: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
  customerName: string;
  tagLabel: string | null;
  staffName: string | null;
}

function NfcHistoryCard({ base, businessId }: { base: string; businessId: string }) {
  const q = useInfiniteQuery({
    queryKey: ["nfc-history", businessId],
    queryFn: ({ pageParam }) =>
      api<{ history: NfcHistoryRow[]; nextBefore: number | null }>(`${base}/nfc-history${pageParam ? `?before=${pageParam}` : ""}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.history) ?? [];
  const tone = (s: string) => (s === "approved" ? "success" : s === "pending" ? "brand" : s === "rejected" ? "danger" : "neutral");
  return (
    <Card title="NFC activity" description="Tap requests and how staff handled them">
      {q.isLoading ? (
        <div className="flex justify-center py-6 text-zinc-400">
          <Spinner />
        </div>
      ) : !rows.length ? (
        <EmptyState title="No NFC activity yet" />
      ) : (
        <>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-b border-zinc-100 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="px-5 py-2 font-medium">Customer</th>
                  <th className="px-5 py-2 font-medium">Tag</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium">Staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-2.5 text-zinc-500">{formatDateTime(r.createdAt)}</td>
                    <td className="px-5 py-2.5">{r.customerName}</td>
                    <td className="px-5 py-2.5">{r.tagLabel ?? "—"}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={tone(r.status)}>{r.status}</Badge>
                      {r.failureReason && <span className="ml-1 text-xs text-zinc-500">{r.failureReason}</span>}
                    </td>
                    <td className="px-5 py-2.5 text-zinc-500">{r.staffName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {q.hasNextPage && (
            <div className="mt-3 flex justify-center">
              <Button size="sm" variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
