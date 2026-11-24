import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fillMessage, loadWaPrefs, varsFor, WA_KIND_LABELS, WA_TEMPLATES, waLink, type WaKind, type WaRecipient } from "../lib/wa-draft";
import { cx } from "./ui";

export function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("size-4", className)} fill="currentColor" aria-hidden>
      <path d="M12.04 2a9.9 9.9 0 0 0-8.5 15l-1.4 5 5.1-1.3A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3a8.2 8.2 0 1 1 6.9 3.8Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4 5.2 5.2 0 0 0 3.2.7 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z" />
    </svg>
  );
}

/** Opens WhatsApp with the message typed in. We record the tap; we can't know whether it was actually sent. */
export function WaSendButton({
  businessId,
  recipient,
  kind,
  text,
  sent,
  onSent,
  label = "Send",
  full,
}: {
  businessId: string;
  recipient: WaRecipient;
  kind: WaKind;
  text: string;
  sent?: boolean;
  onSent?: () => void;
  label?: string;
  full?: boolean;
}) {
  return (
    <a
      href={waLink(recipient.phone, text)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        api(`/api/businesses/${businessId}/wa/log`, { body: { customerId: recipient.customerId, kind } }).catch(() => undefined);
        onSent?.();
      }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition",
        full ? "h-11 w-full" : "h-9",
        sent ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100" : "bg-[#25D366] text-white hover:bg-[#1ebe5b]",
      )}
    >
      <WhatsAppIcon />
      {sent ? "Sent ✓ · again" : label}
    </a>
  );
}

const cardLink = () => `${window.location.origin}/c`;

/** Scanner success screen: one tap to thank the customer on WhatsApp (only if they opted in). */
export function WaThankYou({ businessId, businessName, customerId, rewardUnlocked }: { businessId: string; businessName: string; customerId: string; rewardUnlocked: boolean }) {
  const [sent, setSent] = useState(false);
  const q = useQuery({
    queryKey: ["wa-recipient", businessId, customerId],
    queryFn: () => api<{ recipient: WaRecipient | null }>(`/api/businesses/${businessId}/wa/customers/${customerId}`),
    staleTime: 0,
  });
  const r = q.data?.recipient;
  if (!r) return null;
  const prefs = loadWaPrefs();
  const kind: WaKind = rewardUnlocked && r.readyReward ? "reward_ready" : "thanks";
  const text = fillMessage(WA_TEMPLATES[prefs.lang][kind], varsFor(r, businessName, cardLink()), prefs.lang, prefs.withLink);
  return (
    <WaSendButton
      businessId={businessId}
      recipient={r}
      kind={kind}
      text={text}
      sent={sent}
      onSent={() => setSent(true)}
      label={kind === "reward_ready" ? "Tell them on WhatsApp" : "Send thank-you on WhatsApp"}
      full
    />
  );
}

/** Customer page: quick WhatsApp messages for this one customer. */
export function WaCustomerActions({ businessId, businessName, customerId }: { businessId: string; businessName: string; customerId: string }) {
  const [sent, setSent] = useState<WaKind[]>([]);
  const q = useQuery({
    queryKey: ["wa-recipient", businessId, customerId],
    queryFn: () => api<{ recipient: WaRecipient | null }>(`/api/businesses/${businessId}/wa/customers/${customerId}`),
  });
  if (q.isLoading) return null;
  const r = q.data?.recipient;
  if (!r) return <p className="text-sm text-zinc-500">This customer hasn't agreed to WhatsApp messages from your shop, so messaging is turned off for them.</p>;
  const prefs = loadWaPrefs();
  const kinds: WaKind[] = [r.readyReward ? "reward_ready" : r.stampsToNext != null && r.stampsToNext <= 2 ? "almost_there" : "thanks", "miss_you", "birthday"];
  return (
    <div className="flex flex-wrap gap-2">
      {kinds.map((kind) => (
        <WaSendButton
          key={kind}
          businessId={businessId}
          recipient={r}
          kind={kind}
          text={fillMessage(WA_TEMPLATES[prefs.lang][kind], varsFor(r, businessName, cardLink()), prefs.lang, prefs.withLink)}
          sent={sent.includes(kind)}
          onSent={() => setSent((s) => [...s, kind])}
          label={`${WA_KIND_LABELS[kind].emoji} ${WA_KIND_LABELS[kind].label}`}
        />
      ))}
    </div>
  );
}
