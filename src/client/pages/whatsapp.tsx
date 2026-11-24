import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { SEGMENT_LABELS } from "../lib/crm-api";
import { CUSTOMER_SEGMENTS, type CustomerSegment } from "../../shared/domain";
import {
  fillMessage,
  loadWaPrefs,
  saveWaPrefs,
  varsFor,
  WA_KIND_LABELS,
  WA_LANG_LABELS,
  WA_TEMPLATES,
  waLink,
  type WaKind,
  type WaLang,
  type WaRecipient,
} from "../lib/wa-draft";
import { Alert, Badge, Card, cx, EmptyState, ListLoader, PageHeader, Select, Textarea } from "../components/ui";
import { WaSendButton, WhatsAppIcon } from "../components/WaSend";
import { WhatsAppPreview } from "../components/WhatsAppPreview";
import { useBusinessContext } from "./business";

const DAY = 86_400_000;
const cardLink = () => `${window.location.origin}/c`;
const daysAgo = (ts: number | null) => (ts ? Math.floor((Date.now() - ts) / DAY) : null);
const sentRecently = (r: WaRecipient) => !!r.lastMessagedAt && Date.now() - r.lastMessagedAt < DAY;

export function WhatsAppPage() {
  const { business } = useBusinessContext();
  const [prefs, setPrefs] = useState(loadWaPrefs);
  useEffect(() => saveWaPrefs(prefs), [prefs]);

  return (
    <>
      <PageHeader
        title="WhatsApp messages"
        description="Ready-made messages that open in your own WhatsApp. You just tap Send. Free, no per-message cost."
      />
      <div className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-700">Message language</span>
          <div className="inline-flex rounded-full bg-zinc-100 p-1" role="radiogroup" aria-label="Message language">
            {(Object.keys(WA_LANG_LABELS) as WaLang[]).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={prefs.lang === l}
                onClick={() => setPrefs((p) => ({ ...p, lang: l }))}
                className={cx("rounded-full px-3 py-1 text-sm transition", prefs.lang === l ? "bg-white font-semibold text-zinc-900 shadow-sm" : "text-zinc-500")}
              >
                {WA_LANG_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input type="checkbox" className="size-4 accent-brand-500" checked={prefs.withLink} onChange={(e) => setPrefs((p) => ({ ...p, withLink: e.target.checked }))} />
          Add a link to the customer's card
        </label>
      </div>

      <div className="space-y-6">
        <TodayCard businessId={business.id} shop={business.name} lang={prefs.lang} withLink={prefs.withLink} />
        <BulkCard businessId={business.id} shop={business.name} lang={prefs.lang} withLink={prefs.withLink} />
        <Tips />
      </div>
    </>
  );
}

// ---------- Today's to-do ----------

type TodayResponse = { birthdays: WaRecipient[]; rewardReady: WaRecipient[]; missYou: WaRecipient[] };

function TodayCard({ businessId, shop, lang, withLink }: { businessId: string; shop: string; lang: WaLang; withLink: boolean }) {
  const q = useQuery({ queryKey: ["wa-today", businessId], queryFn: () => api<TodayResponse>(`/api/businesses/${businessId}/wa/today`) });
  const [sent, setSent] = useState<Set<string>>(new Set());
  const groups: { kind: WaKind; title: string; rows: WaRecipient[]; detail: (r: WaRecipient) => string }[] = q.data
    ? [
        { kind: "birthday", title: "🎂 Birthdays today", rows: q.data.birthdays, detail: () => "Birthday today" },
        { kind: "reward_ready", title: "🎁 Reward waiting", rows: q.data.rewardReady, detail: (r) => `${r.readyReward} ready` },
        { kind: "miss_you", title: "😊 Haven't visited in a while", rows: q.data.missYou, detail: (r) => `Last visit ${daysAgo(r.lastVisitAt) ?? "?"} days ago` },
      ]
    : [];
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <Card title="📋 Today's list" description="Customers worth a message today. Anyone you messaged in the last 7 days is left out.">
      {q.isLoading ? (
        <ListLoader />
      ) : q.error ? (
        <Alert>Could not load today's list.</Alert>
      ) : total === 0 ? (
        <EmptyState title="Nothing to send today 🎉" description="No birthdays, waiting rewards or missing regulars right now. Check again tomorrow." />
      ) : (
        <div className="space-y-5">
          {groups
            .filter((g) => g.rows.length)
            .map((g) => (
              <section key={g.kind}>
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800">
                  {g.title} <Badge>{g.rows.length}</Badge>
                </h3>
                <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                  {g.rows.map((r) => (
                    <RecipientRow
                      key={r.customerId}
                      r={r}
                      detail={g.detail(r)}
                      action={
                        <WaSendButton
                          businessId={businessId}
                          recipient={r}
                          kind={g.kind}
                          text={fillMessage(WA_TEMPLATES[lang][g.kind], varsFor(r, shop, cardLink()), lang, withLink)}
                          sent={sent.has(`${g.kind}:${r.customerId}`)}
                          onSent={() => setSent((s) => new Set(s).add(`${g.kind}:${r.customerId}`))}
                        />
                      }
                    />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Card>
  );
}

function RecipientRow({ r, detail, action }: { r: WaRecipient; detail: string; action: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{r.name[0]}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{r.name}</span>
        <span className="block truncate text-xs text-zinc-500">
          {detail} · {r.stamps}/{r.stampsRequired} stamps
        </span>
      </span>
      {action}
    </li>
  );
}

// ---------- Message many customers ----------

const BULK_KINDS: WaKind[] = ["offer", "almost_there", "miss_you", "reward_ready", "thanks"];

function BulkCard({ businessId, shop, lang, withLink }: { businessId: string; shop: string; lang: WaLang; withLink: boolean }) {
  const [segment, setSegment] = useState<CustomerSegment | "">("");
  const [kind, setKind] = useState<WaKind>("offer");
  const [text, setText] = useState(WA_TEMPLATES[lang].offer);
  const [edited, setEdited] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());

  // Switching message type or language loads that template, unless the owner has written their own text.
  useEffect(() => {
    if (!edited) setText(WA_TEMPLATES[lang][kind]);
  }, [lang, kind, edited]);

  const q = useQuery({
    queryKey: ["wa-audience", businessId, segment],
    queryFn: () => api<{ recipients: WaRecipient[] }>(`/api/businesses/${businessId}/wa/audience${segment ? `?segment=${segment}` : ""}`),
  });
  const all = q.data?.recipients ?? [];
  // Messages about rewards only make sense for customers who have one.
  const list = useMemo(
    () => (kind === "reward_ready" ? all.filter((r) => r.readyReward) : kind === "almost_there" ? all.filter((r) => r.stampsToNext != null) : all),
    [all, kind],
  );
  const done = list.filter((r) => sent.has(r.customerId)).length;
  const next = list.find((r) => !sent.has(r.customerId));
  const messageFor = (r: WaRecipient) => fillMessage(text, varsFor(r, shop, cardLink()), lang, withLink);
  const markSent = (id: string) => setSent((s) => new Set(s).add(id));
  const sample = list[0];

  return (
    <Card title="📣 Message many customers" description="Write once, then send one by one from your WhatsApp.">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <div className="min-w-0 space-y-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-zinc-800">1. Who?</p>
            <Select label="" aria-label="Customers" value={segment} onChange={(e) => setSegment(e.target.value as CustomerSegment | "")}>
              <option value="">All customers who said yes to WhatsApp</option>
              {CUSTOMER_SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {SEGMENT_LABELS[s]} customers
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-xs text-zinc-500">{q.isLoading ? "Counting…" : `${list.length} customer${list.length === 1 ? "" : "s"}`}</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-zinc-800">2. What message?</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {BULK_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setKind(k);
                    setEdited(false);
                  }}
                  className={cx(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    kind === k ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-zinc-300 bg-white text-zinc-700 hover:border-brand-400",
                  )}
                >
                  {WA_KIND_LABELS[k].emoji} {WA_KIND_LABELS[k].label}
                </button>
              ))}
            </div>
            <Textarea
              label=""
              aria-label="Message"
              rows={5}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setEdited(true);
              }}
              hint="Use {name}, {shop}, {stamps}, {total}, {left} and {reward}. They're filled in for each customer."
            />
            {kind === "offer" && !edited && <p className="mt-1 text-sm text-amber-700">✏️ Finish the sentence with your offer, e.g. “20% off all cakes till Sunday!”</p>}
            {edited && (
              <button type="button" onClick={() => setEdited(false)} className="mt-1 text-sm font-medium text-brand-600 hover:underline">
                Reset to the ready-made message
              </button>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-800">3. Send</p>
              <span className="text-xs text-zinc-500">
                {done} of {list.length} opened
              </span>
            </div>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-zinc-100" role="progressbar" aria-valuenow={done} aria-valuemax={list.length}>
              <div className="h-full rounded-full bg-[#25D366] transition-all" style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} />
            </div>
            {next && (
              <a
                href={waLink(next.phone, messageFor(next))}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  api(`/api/businesses/${businessId}/wa/log`, { body: { customerId: next.customerId, kind } }).catch(() => undefined);
                  markSent(next.customerId);
                }}
                className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] text-base font-semibold text-white shadow-sm hover:bg-[#1ebe5b]"
              >
                <WhatsAppIcon className="size-5" /> Send to {next.name.split(" ")[0]} ({done + 1}/{list.length})
              </a>
            )}
            {list.length > 0 && !next && <Alert tone="success">All done! Every message on this list was opened in WhatsApp.</Alert>}
            {q.isLoading ? (
              <ListLoader />
            ) : !list.length ? (
              <EmptyState title="No customers here" description="Only customers who agreed to WhatsApp messages from your shop appear." />
            ) : (
              <ul className="max-h-96 divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-200">
                {list.map((r) => (
                  <RecipientRow
                    key={r.customerId}
                    r={r}
                    detail={sentRecently(r) && !sent.has(r.customerId) ? "Messaged in the last day" : r.lastVisitAt ? `Visited ${daysAgo(r.lastVisitAt)}d ago` : "No visit yet"}
                    action={
                      <WaSendButton businessId={businessId} recipient={r} kind={kind} text={messageFor(r)} sent={sent.has(r.customerId)} onSent={() => markSent(r.customerId)} />
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="lg:sticky lg:top-6" aria-label="Message preview">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden /> What {sample ? sample.name.split(" ")[0] : "a customer"} will see
          </p>
          <WhatsAppPreview
            businessName={shop}
            templateName=""
            templateText={
              sample
                ? messageFor(sample)
                : fillMessage(text, { name: "Riya", shop, stamps: 7, total: 10, left: 3, reward: "your reward", ready: "your reward", link: cardLink() }, lang, withLink)
            }
            values={[]}
          />
        </aside>
      </div>
    </Card>
  );
}

function Tips() {
  return (
    <Card title="Good to know">
      <ul className="space-y-2 text-sm text-zinc-600">
        <li>✅ Only customers who agreed to WhatsApp messages from your shop are shown.</li>
        <li>
          📱 Use the free <b>WhatsApp Business</b> app on your phone, so customers see your shop name and logo.
        </li>
        <li>
          ⚠️ Send to about <b>50–100 people a day</b>, and keep messages personal. If many people report your messages as spam, WhatsApp can block your number.
        </li>
        <li>💬 We know when you opened a message, not whether you pressed Send. The list remembers who you've opened.</li>
        <li className="text-zinc-400">Automatic sending (WhatsApp Business API) is coming later for shops that want it.</li>
      </ul>
    </Card>
  );
}
