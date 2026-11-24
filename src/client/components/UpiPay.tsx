import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatDateIN, formatINR } from "../lib/billing-format";
import { QrCode } from "./QrCode";
import { Alert, Button, Input, Modal, Spinner } from "./ui";

interface UpiStart {
  reference: string;
  amountPaise: number;
  planName: string;
  upiId: string;
  payeeName: string;
  upiUri: string;
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Shrink a screenshot to ≤1200px JPEG so it stays well under the 600 KB upload limit. */
async function compressProof(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob) throw new Error("encode failed");
  return new File([blob], "payment-proof.jpg", { type: "image/jpeg" });
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2">
      <span className="min-w-0">
        <span className="block text-xs text-zinc-500">{label}</span>
        <span className="block truncate font-mono text-sm font-semibold">{value}</span>
      </span>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 text-sm font-medium text-brand-600 hover:underline"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

/** Manual UPI checkout: pay from any UPI app, then enter the UTR. A Super Admin confirms it. */
export function UpiPayModal({ planCode, open, onClose, onSubmitted }: { planCode: string | null; open: boolean; onClose: () => void; onSubmitted: () => void }) {
  const [start, setStart] = useState<UpiStart | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<"pay" | "confirm" | "done">("pay");
  const [utr, setUtr] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [provisionalUntil, setProvisionalUntil] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !planCode) return;
    setStart(null);
    setLoadError(null);
    setStep("pay");
    setUtr("");
    setProof(null);
    setErrors({});
    setError(null);
    api<UpiStart>("/api/billing/upi/start", { body: { planCode } })
      .then(setStart)
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Could not start the payment. Please try again."));
  }, [open, planCode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!start) return;
    setSaving(true);
    setErrors({});
    setError(null);
    const form = new FormData();
    form.set("reference", start.reference);
    form.set("utr", utr);
    if (proof) form.set("proof", proof);
    try {
      const res = await api<{ status: string; provisionalUntil: string | null }>("/api/billing/upi/submit", { form });
      setProvisionalUntil(res.provisionalUntil);
      setStep("done");
      onSubmitted();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setError(err.code === "UTR_USED" || !Object.keys(err.fieldErrors()).length ? err.message : null);
      } else setError("No internet connection. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={start ? `Pay ${formatINR(start.amountPaise)} for ${start.planName}` : "Pay with UPI"}>
      {loadError ? (
        <Alert>{loadError}</Alert>
      ) : !start ? (
        <div className="flex justify-center py-10 text-zinc-400">
          <Spinner />
        </div>
      ) : step === "done" ? (
        <div className="space-y-4 text-center">
          <p className="text-4xl">⏳</p>
          <p className="text-lg font-semibold">Payment submitted</p>
          <p className="text-sm text-zinc-600">
            We'll check your payment <b>{start.reference}</b> and activate your plan, usually within a few hours.
          </p>
          {provisionalUntil && (
            <Alert tone="success">
              Meanwhile, {start.planName} is active for you until {formatDateIN(provisionalUntil)}.
            </Alert>
          )}
          <Button className="w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : step === "pay" ? (
        <div className="space-y-4">
          <ol className="flex items-center gap-2 text-xs font-medium text-zinc-500" aria-label="Steps">
            <li className="rounded-full bg-brand-500 px-2.5 py-1 text-white">1. Pay</li>
            <li aria-hidden>→</li>
            <li className="rounded-full bg-zinc-100 px-2.5 py-1">2. Enter transaction ID</li>
          </ol>
          <div className="flex flex-col items-center rounded-2xl border border-zinc-200 p-4">
            <p className="text-3xl font-bold tabular-nums">{formatINR(start.amountPaise)}</p>
            <p className="text-sm text-zinc-500">to {start.payeeName}</p>
            <QrCode value={start.upiUri} size={200} label="UPI payment QR code" className="mt-3 rounded-lg" />
            <p className="mt-2 text-xs text-zinc-500">Scan with GPay, PhonePe, Paytm or any UPI app</p>
            {isPhone() && (
              <a
                href={start.upiUri}
                className="mt-3 flex h-12 w-full items-center justify-center rounded-xl bg-emerald-600 text-base font-semibold text-white hover:bg-emerald-700"
              >
                Pay {formatINR(start.amountPaise)} with UPI app
              </a>
            )}
          </div>
          <CopyRow label="UPI ID" value={start.upiId} />
          <CopyRow label="Payment reference (add it in the note if asked)" value={start.reference} />
          <Button className="h-11 w-full" onClick={() => setStep("confirm")}>
            I've paid, next →
          </Button>
          <p className="text-center text-xs text-zinc-500">Pay the exact amount. Don't close this window until you've noted the transaction ID.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <ol className="flex items-center gap-2 text-xs font-medium text-zinc-500" aria-label="Steps">
            <li className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">1. Paid ✓</li>
            <li aria-hidden>→</li>
            <li className="rounded-full bg-brand-500 px-2.5 py-1 text-white">2. Enter transaction ID</li>
          </ol>
          {error && <Alert>{error}</Alert>}
          <Input
            label="UPI transaction ID (UTR)"
            value={utr}
            onChange={(e) => setUtr(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 412345678901"
            required
            error={errors.utr}
            hint="12-digit number in your UPI app under the payment's details (called UTR, UPI Ref No. or Transaction ID)."
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-zinc-700">Payment screenshot (optional)</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  setProof(await compressProof(f));
                } catch {
                  setErrors((x) => ({ ...x, proof: "Couldn't read that image. Try another one." }));
                }
              }}
            />
            <div className="flex items-center gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                {proof ? "Change screenshot" : "Add screenshot"}
              </Button>
              {proof && (
                <span className="text-sm text-emerald-700">
                  ✓ Added{" "}
                  <button type="button" className="text-zinc-500 underline" onClick={() => setProof(null)}>
                    remove
                  </button>
                </span>
              )}
            </div>
            {errors.proof && <p className="mt-1 text-sm text-red-600">{errors.proof}</p>}
            <p className="mt-1 text-xs text-zinc-500">Helps us find your payment faster.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setStep("pay")}>
              ← Back
            </Button>
            <Button type="submit" className="flex-1" loading={saving} disabled={utr.replace(/\s/g, "").length < 10}>
              Submit payment
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Printable receipt for a paid plan. */
export function printReceipt(p: { orderId: string; paymentId: string | null; amountPaise: number; planName: string; paidAt: string | null }, billedTo: { name: string; email: string }) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(p.orderId)}</title><style>
body{font-family:system-ui,-apple-system,sans-serif;color:#18181b;max-width:560px;margin:40px auto;padding:0 20px}
h1{font-size:22px;margin:0}.muted{color:#71717a;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:24px}
td{padding:10px 0;border-bottom:1px solid #e4e4e7;font-size:14px}td:last-child{text-align:right;font-weight:600}
.total td{font-size:16px;border-bottom:none}.paid{display:inline-block;margin-top:16px;padding:4px 10px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600}
</style></head><body>
<h1>Repeatly</h1><p class="muted">Payment receipt</p>
<p style="margin-top:24px"><b>Billed to:</b> ${esc(billedTo.name)} (${esc(billedTo.email)})</p>
<table>
<tr><td>Receipt no.</td><td>${esc(p.orderId)}</td></tr>
<tr><td>Date</td><td>${esc(p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "-")}</td></tr>
<tr><td>Plan</td><td>${esc(p.planName)} (30 days)</td></tr>
<tr><td>Payment reference</td><td>${esc(p.paymentId ?? "-")}</td></tr>
<tr class="total"><td>Amount paid</td><td>₹${(p.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td></tr>
</table>
<span class="paid">PAID</span>
<script>window.onload=function(){setTimeout(function(){window.print()},200)}</script>
</body></html>`);
  w.document.close();
  return true;
}
