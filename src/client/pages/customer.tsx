import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { captchaHeaders } from "../lib/auth";
import { formatDate, formatDateTime, safeRelative, type CustomerCard, type CustomerSession } from "../lib/loyalty-api";
import { detectNfc } from "../lib/nfc";
import { Alert, Badge, Button, cx, Input, PageLoader, Select, Spinner } from "../components/ui";
import { Turnstile } from "../components/Turnstile";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { QrCode } from "../components/QrCode";
import { GoogleReviewButton } from "../components/GoogleReviewSheet";
import { GoogleWalletButton } from "../components/GoogleWalletButton";
import { InstallCardPrompt } from "../components/InstallCardPrompt";
import { CustomerShell } from "./public-business";

const useCustomerSession = () =>
  useQuery({ queryKey: ["customer-session"], queryFn: () => api<CustomerSession>("/api/c/session"), staleTime: 60_000 });

function TopBar({ back }: { back?: { to: string; label: string } }) {
  return (
    <div className="mb-5 flex items-center justify-between text-sm">
      {back ? (
        <Link to={back.to} className="font-medium text-brand-600">
          ← {back.label}
        </Link>
      ) : (
        <span className="font-semibold text-zinc-900">My loyalty cards</span>
      )}
      <Link to="/c/settings" className="rounded-full p-2 text-zinc-500 hover:bg-white" aria-label="Settings">
        <svg viewBox="0 0 20 20" className="size-5" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 0 1 .804.98v1.361a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.294 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.294A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            clipRule="evenodd"
          />
        </svg>
      </Link>
    </div>
  );
}

function SignedOut({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-10 rounded-2xl bg-white p-6 text-center shadow-sm">
      <p className="text-4xl">💳</p>
      <h1 className="mt-3 text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-zinc-600">{text}</p>
      <Link to="/c/login">
        <Button className="mt-6 h-12 w-full text-base">Find my cards</Button>
      </Link>
      <p className="mt-4 text-sm text-zinc-500">New here? Scan the QR code at the shop to get a card.</p>
    </div>
  );
}

export function CustomerCardsPage() {
  const session = useCustomerSession();
  const cards = useQuery({
    queryKey: ["customer-cards"],
    queryFn: () => api<{ cards: CustomerCard[] }>("/api/c/cards"),
    enabled: !!session.data?.customer,
  });

  if (session.isLoading) return <PageLoader />;
  if (!session.data?.customer) {
    return (
      <CustomerShell>
        <SignedOut title="Your loyalty cards" text="Verify your mobile number to see the cards you've collected." />
      </CustomerShell>
    );
  }

  return (
    <CustomerShell>
      <TopBar />
      <h1 className="text-2xl font-bold tracking-tight">Hi {session.data.customer.name.split(" ")[0]} 👋</h1>
      <p className="mt-1 text-zinc-600">Tap a card to collect points or redeem rewards.</p>
      {!!cards.data?.cards.length && <InstallCardPrompt />}
      <div className="mt-6 space-y-4">
        {cards.isLoading ? (
          <div className="flex justify-center py-10 text-zinc-400">
            <Spinner />
          </div>
        ) : cards.error ? (
          <Alert>Could not load your cards. Pull to refresh.</Alert>
        ) : !cards.data?.cards.length ? (
          <div className="rounded-2xl bg-white p-6 text-center text-zinc-600 shadow-sm">No cards yet. Scan a shop's QR code to join.</div>
        ) : (
          cards.data.cards.map((c) => (
            <div key={c.id}>
              <Link to={`/c/cards/${c.id}`} className="block transition active:scale-[0.99]">
                <LoyaltyCard
                  compact
                  businessName={c.business.name}
                  logoUrl={c.business.logoUrl}
                  programName={c.program.name}
                  stampIcon={c.program.stampIcon}
                  stampsRequired={c.program.stampsRequired}
                  points={c.pointsBalance}
                  rewards={c.rewards}
                />
              </Link>
              {c.business.reviewButton && <GoogleReviewButton slug={c.business.slug} businessName={c.business.name} />}
            </div>
          ))
        )}
      </div>
    </CustomerShell>
  );
}

function CountdownRing({ expiresAt, total }: { expiresAt: number; total: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, expiresAt - now);
  const frac = Math.min(1, left / total);
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
      <svg viewBox="0 0 24 24" className="size-5 -rotate-90" aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} className="text-brand-500" />
      </svg>
      Refreshes in {Math.ceil(left / 1000)}s
    </span>
  );
}

const REFRESH_MS = 60_000;

function RotatingQr({ cardId, enabled }: { cardId: string; enabled: boolean }) {
  const [token, setToken] = useState<{ token: string; expiresAt: number; issuedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const r = await api<{ token: string; expiresAt: string }>(`/api/c/cards/${cardId}/token`, { method: "POST" });
      setToken({ token: r.token, expiresAt: new Date(r.expiresAt).getTime(), issuedAt: Date.now() });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't refresh your code. Check your internet.");
    } finally {
      timer.current = setTimeout(refresh, REFRESH_MS);
    }
  }, [cardId]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, refresh]);

  if (!enabled) return null;
  return (
    <div className="flex flex-col items-center rounded-3xl bg-white p-5 shadow-sm">
      {error && !token ? (
        <Alert tone="warning">{error}</Alert>
      ) : !token ? (
        <div className="flex size-[220px] items-center justify-center text-zinc-400">
          <Spinner className="size-7" />
        </div>
      ) : (
        <>
          <QrCode value={token.token} size={220} label="Your loyalty card QR code" className={cx(Date.now() > token.expiresAt && "opacity-30")} />
          <div className="mt-3">
            <CountdownRing expiresAt={token.issuedAt + REFRESH_MS} total={REFRESH_MS} />
          </div>
          {error && <p className="mt-2 text-xs text-amber-700">{error}</p>}
        </>
      )}
      <p className="mt-3 text-center font-medium text-zinc-800">Show this to staff to collect a point or redeem a reward</p>
      <p className="mt-1 text-center text-xs text-zinc-500">Turn up your screen brightness if it doesn't scan.</p>
    </div>
  );
}

export function CustomerCardPage() {
  const { cardId = "" } = useParams();
  const session = useCustomerSession();
  const q = useQuery({
    queryKey: ["customer-card", cardId],
    queryFn: () =>
      api<{ card: CustomerCard; history: { id: string; type: "earn" | "redeem" | "adjust"; points: number; channel: string; createdAt: string }[] }>(
        `/api/c/cards/${cardId}`,
      ),
    enabled: !!session.data?.customer,
    refetchInterval: 15_000,
  });
  const [nfcNote, setNfcNote] = useState(false);
  const reported = useRef(false);
  const caps = detectNfc();

  if (session.isLoading || (session.data?.customer && q.isLoading)) return <PageLoader />;
  if (!session.data?.customer) {
    return (
      <CustomerShell>
        <SignedOut title="Open your card" text="This card is linked to your mobile number. Verify it to continue." />
      </CustomerShell>
    );
  }
  if (q.error || !q.data) {
    return (
      <CustomerShell>
        <TopBar back={{ to: "/c", label: "My cards" }} />
        <Alert>We couldn't find this card on your account.</Alert>
      </CustomerShell>
    );
  }

  const { card, history } = q.data;
  const blocked = card.status === "blocked";
  const usable = !blocked && card.business.active;
  const ready = card.rewards.filter((r) => r.unlocked);

  function tryPhoneTap() {
    setNfcNote(true);
    if (!reported.current) {
      reported.current = true;
      api("/api/c/device-unsupported", { body: { businessId: card.business.id, feature: "nfc_phone" } }).catch(() => undefined);
    }
  }

  return (
    <CustomerShell>
      <TopBar back={{ to: "/c", label: "My cards" }} />
      <LoyaltyCard
        businessName={card.business.name}
        logoUrl={card.business.logoUrl}
        programName={card.program.name}
        customerName={session.data.customer.name}
        stampIcon={card.program.stampIcon}
        stampsRequired={card.program.stampsRequired}
        points={card.pointsBalance}
        rewards={card.rewards}
      />

      {card.googleWallet && usable && <GoogleWalletButton cardId={card.id} />}
      {card.business.reviewButton && <GoogleReviewButton slug={card.business.slug} businessName={card.business.name} />}
      <InstallCardPrompt />

      {ready.length > 0 && usable && (
        <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-emerald-900">
          <p className="font-semibold">🎉 Ready to redeem: {ready.map((r) => r.name).join(", ")}</p>
          <p className="text-sm">Show the QR below to staff to claim it.</p>
        </div>
      )}
      {blocked && (
        <div className="mt-4">
          <Alert>This card has been blocked by the shop. Please speak to the staff.</Alert>
        </div>
      )}
      {!card.business.active && (
        <div className="mt-4">
          <Alert tone="warning">This shop's loyalty program is temporarily unavailable.</Alert>
        </div>
      )}
      {usable && !card.program.live && (
        <div className="mt-4">
          <Alert tone="warning">This program isn't collecting new points right now. Rewards you've unlocked can still be redeemed.</Alert>
        </div>
      )}

      <div className="mt-5">
        <RotatingQr cardId={card.id} enabled={usable} />
      </div>

      {usable && (
        <div className="mt-4 space-y-2 text-sm text-zinc-600">
          {card.business.nfcTagEnabled && <p className="rounded-xl bg-white p-3 shadow-sm">📱 Or tap the shop's NFC tag with your phone, then show the 4-digit code to staff.</p>}
          {!caps.phoneToPhone && (
            <div className="rounded-xl bg-white p-3 shadow-sm">
              {nfcNote ? (
                <p>
                  Phone-to-phone tap isn't supported in {caps.ios ? "iPhone browsers" : "web browsers"}. Please show the QR code above
                  {card.business.nfcTagEnabled ? " or tap the shop's NFC tag" : ""}.
                </p>
              ) : (
                <button className="text-brand-600 hover:underline" onClick={tryPhoneTap}>
                  Try tapping phones together?
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Rewards</h2>
        <ul className="mt-3 space-y-2">
          {card.rewards.map((r) => (
            <li key={r.id} className="flex items-center gap-3">
              <span
                className={cx(
                  "flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                  r.unlocked ? "bg-emerald-500 text-white" : "bg-zinc-100 text-zinc-600",
                )}
              >
                {r.unlocked ? "✓" : r.pointsRequired}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-zinc-500">
                  {r.unlocked ? "Ready to redeem — show your QR to staff" : `${r.pointsRequired - card.pointsBalance} more to go`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-semibold">History</h2>
        {!history.length ? (
          <p className="mt-2 text-sm text-zinc-500">No visits yet. Your first point is one purchase away!</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>{h.type === "earn" ? "Point collected" : h.type === "redeem" ? "Reward redeemed" : "Adjustment"}</span>
                <span className="flex items-center gap-3">
                  <span className={cx("font-semibold tabular-nums", h.points > 0 ? "text-emerald-600" : "text-zinc-700")}>
                    {h.points > 0 ? `+${h.points}` : h.points}
                  </span>
                  <span className="text-xs text-zinc-500">{formatDateTime(h.createdAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(card.program.terms || card.program.endsAt || card.program.description) && (
        <details className="mt-4 rounded-2xl bg-white p-5 text-sm text-zinc-600 shadow-sm">
          <summary className="cursor-pointer font-semibold text-zinc-900">About this card</summary>
          {card.program.description && <p className="mt-2">{card.program.description}</p>}
          {card.program.endsAt && <p className="mt-2">Program ends {formatDate(card.program.endsAt)}.</p>}
          {card.program.terms && <p className="mt-2 whitespace-pre-line">{card.program.terms}</p>}
        </details>
      )}

      <p className="mt-6 text-center text-sm">
        <Link to={`/s/${card.business.slug}`} className="text-brand-600 hover:underline">
          Visit {card.business.name}'s page
        </Link>
      </p>
    </CustomerShell>
  );
}

export function CustomerLoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [phone, setPhone] = useState(params.get("phone") ?? "");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setCaptcha(t), []);
  const next = safeRelative(params.get("next"), "/c");
  const session = useCustomerSession();
  const otp = session.data?.loginMode === "otp";

  function message(e: unknown) {
    if (!(e instanceof ApiError)) return "No internet connection. Please try again.";
    if (e.code === "OTP_UNAVAILABLE") return "Mobile verification isn't available yet. Please ask the shop staff to help you.";
    if (e.status === 429) return e.message || "Too many attempts. Please wait and try again.";
    return e.message;
  }

  async function login(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/c/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...captchaHeaders(captcha) },
        body: JSON.stringify({ phone }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new ApiError(res.status, j?.error?.code ?? "UNKNOWN", j?.error?.message ?? "Could not open your cards", j?.error?.details);
      }
      await qc.invalidateQueries();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === "BAD_REQUEST" ? "Enter a valid 10-digit mobile number" : message(err));
    } finally {
      setLoading(false);
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/c/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...captchaHeaders(captcha) },
        body: JSON.stringify({ phone }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new ApiError(res.status, j?.error?.code ?? "UNKNOWN", j?.error?.message ?? "Could not send the code", j?.error?.details);
      }
      setStep("code");
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setLoading(true);
    setError(null);
    try {
      await api("/api/c/otp/verify", { body: { phone, code } });
      await qc.invalidateQueries();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === "NOT_FOUND" ? "We couldn't find a loyalty card for this number. Scan a shop's QR code to join." : message(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <CustomerShell>
      <TopBar back={{ to: "/c", label: "My cards" }} />
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">Find my cards</h1>
        {session.isLoading ? (
          <div className="mt-5 h-40 animate-pulse rounded-xl bg-zinc-100" />
        ) : step === "phone" ? (
          <form onSubmit={otp ? send : login} className="mt-5 space-y-4">
            <p className="text-zinc-600">
              {otp ? "Enter the mobile number you used to join. We'll send a one-time code." : "Enter the mobile number you used to join a shop's loyalty card."}
            </p>
            {error && <Alert>{error}</Alert>}
            <Input
              label="Mobile number"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
              className="h-12 text-base"
            />
            <Turnstile onToken={onToken} />
            <Button type="submit" className="h-12 w-full text-base" loading={loading} disabled={phone.replace(/\D/g, "").length < 10}>
              {otp ? "Send code" : "Show my cards"}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="mt-5 space-y-4">
            <p className="text-zinc-600">If this number has a loyalty card, we've sent a 6-digit code to it.</p>
            {error && <Alert>{error}</Alert>}
            <Input
              label="Code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{4,8}"
              required
              autoFocus
              className="h-12 text-center font-mono text-xl tracking-[0.4em]"
            />
            <Button type="submit" className="h-12 w-full text-base" loading={loading}>
              Verify
            </Button>
            <div className="flex justify-between text-sm">
              <button type="button" className="text-brand-600 hover:underline" onClick={() => setStep("phone")}>
                Change number
              </button>
              <button type="button" className="text-brand-600 hover:underline" onClick={() => send()} disabled={loading}>
                Resend code
              </button>
            </div>
            {import.meta.env.DEV && <p className="text-xs text-zinc-400">Development: the code is printed in the server log.</p>}
          </form>
        )}
      </div>
    </CustomerShell>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function CustomerSettingsPage() {
  const session = useCustomerSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const consents = useQuery({
    queryKey: ["customer-consents"],
    queryFn: () => api<{ businesses: { businessId: string; name: string; channels: Record<string, boolean> }[] }>("/api/c/consents"),
    enabled: !!session.data?.customer,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api("/api/c/me", { method: "PATCH", body }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      qc.invalidateQueries({ queryKey: ["customer-session"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save"),
  });
  const consent = useMutation({
    mutationFn: (body: { businessId: string; channel: string; granted: boolean }) => api("/api/c/consents", { method: "PUT", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-consents"] }),
  });
  const logout = useMutation({
    mutationFn: () => api("/api/c/logout", { method: "POST" }),
    onSuccess: async () => {
      qc.clear();
      navigate("/c", { replace: true });
    },
  });
  const remove = useMutation({
    mutationFn: () => api("/api/c/me", { method: "DELETE" }),
    onSuccess: () => {
      qc.clear();
      navigate("/c", { replace: true });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not delete your data"),
  });

  if (session.isLoading) return <PageLoader />;
  const customer = session.data?.customer;
  if (!customer) {
    return (
      <CustomerShell>
        <SignedOut title="Settings" text="Verify your mobile number to manage your details." />
      </CustomerShell>
    );
  }
  const [bm, bd] = customer.birthday?.split("-") ?? ["", ""];

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const month = String(f.get("bmonth"));
    const day = String(f.get("bday"));
    setSaved(false);
    save.mutate({
      name: String(f.get("name")).trim(),
      email: String(f.get("email")).trim(),
      birthday: month && day ? `${month}-${day}` : null,
    });
  }

  return (
    <CustomerShell>
      <TopBar back={{ to: "/c", label: "My cards" }} />
      <div className="space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Your details</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Mobile: {customer.phone ? `+91 ${customer.phone}` : "—"} {customer.phoneVerified && <Badge tone="success">Verified</Badge>}
          </p>
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            {error && <Alert>{error}</Alert>}
            {saved && <Alert tone="success">Saved</Alert>}
            <Input label="Name" name="name" defaultValue={customer.name} required minLength={2} maxLength={80} className="h-12 text-base" />
            <Input label="Email (optional)" name="email" type="email" defaultValue={customer.email ?? ""} className="h-12 text-base" />
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-zinc-700">Birthday (optional)</legend>
              <div className="grid grid-cols-2 gap-2">
                <Select name="bday" defaultValue={bd ?? ""} aria-label="Day" className="h-12 text-base">
                  <option value="">Day</option>
                  {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
                    <option key={d} value={d}>
                      {Number(d)}
                    </option>
                  ))}
                </Select>
                <Select name="bmonth" defaultValue={bm ?? ""} aria-label="Month" className="h-12 text-base">
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={String(i + 1).padStart(2, "0")}>
                      {m}
                    </option>
                  ))}
                </Select>
              </div>
            </fieldset>
            <Button type="submit" className="h-12 w-full text-base" loading={save.isPending}>
              Save
            </Button>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold">WhatsApp offers</h2>
          <p className="mt-1 text-sm text-zinc-500">Choose which shops can send you offers. Your points work either way.</p>
          {consents.isLoading ? (
            <div className="flex justify-center py-4 text-zinc-400">
              <Spinner />
            </div>
          ) : !consents.data?.businesses.length ? (
            <p className="mt-3 text-sm text-zinc-500">No shops yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {consents.data.businesses.map((b) => {
                const on = !!b.channels.whatsapp;
                return (
                  <li key={b.businessId} className="flex items-center justify-between gap-3 py-3">
                    <span className="font-medium">{b.name}</span>
                    <button
                      role="switch"
                      aria-checked={on}
                      aria-label={`WhatsApp offers from ${b.name}`}
                      disabled={consent.isPending}
                      onClick={() => consent.mutate({ businessId: b.businessId, channel: "whatsapp", granted: !on })}
                      className={cx("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors", on ? "bg-brand-500" : "bg-zinc-300")}
                    >
                      <span className={cx("inline-block size-6 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Button variant="secondary" className="h-12 w-full text-base" loading={logout.isPending} onClick={() => logout.mutate()}>
          Sign out on this phone
        </Button>

        <section className="rounded-2xl border border-red-200 bg-white p-5">
          <h2 className="font-semibold text-red-700">Delete my data</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Removes your name, mobile number, email and birthday, withdraws all WhatsApp permissions and signs you out. You will lose access to all
            your loyalty cards and unredeemed points. This can't be undone.
          </p>
          {confirmDelete ? (
            <div className="mt-4 space-y-2">
              <Button variant="danger" className="h-12 w-full text-base" loading={remove.isPending} onClick={() => remove.mutate()}>
                Yes, permanently delete my data
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" className="mt-4 w-full" onClick={() => setConfirmDelete(true)}>
              Delete my data
            </Button>
          )}
        </section>
      </div>
    </CustomerShell>
  );
}
