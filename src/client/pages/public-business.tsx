import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { captchaHeaders, TURNSTILE_SITE_KEY } from "../lib/captcha";
import { type CustomerSession, type NfcRequestStatus, type PublicBusiness } from "../lib/loyalty-api";
import { Alert, Button, Input, Select, Spinner } from "../components/ui";
import { ShopPageSkeleton } from "../components/skeletons";
import { Turnstile } from "../components/Turnstile";
import { HowItWorksStrip, ProgramOffer, ShopContactRow, ShopHeader } from "../components/ShopPage";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function CustomerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 to-zinc-50">
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-6">{children}</div>
    </div>
  );
}

export function LinkInvalidPage() {
  return (
    <CustomerShell>
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="text-4xl">🔗</p>
        <h1 className="mt-3 text-xl font-semibold">This link isn't working</h1>
        <p className="mt-2 text-zinc-600">The QR code or NFC tag may have been replaced. Ask the shop for their current code.</p>
        <Link to="/c" className="mt-6 inline-block font-medium text-brand-600">
          Open my loyalty cards
        </Link>
      </div>
    </CustomerShell>
  );
}

function NotFound() {
  return (
    <CustomerShell>
      <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm">
        <p className="text-4xl">🏪</p>
        <h1 className="mt-3 text-xl font-semibold">Shop not found</h1>
        <p className="mt-2 text-zinc-600">This loyalty page isn't available right now.</p>
        <Link to="/c" className="mt-6 inline-block font-medium text-brand-600">
          Open my loyalty cards
        </Link>
      </div>
    </CustomerShell>
  );
}

export function PublicBusinessPage() {
  const { slug = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tag = params.get("tag");
  const key = ["public-business", slug];
  const { data, isLoading, error } = useQuery({ queryKey: key, queryFn: () => api<PublicBusiness>(`/api/public/b/${slug}`), retry: false });
  const [nfcCardId, setNfcCardId] = useState<string | null>(null);

  const myCardFor = (programId: string) => data?.myCards.find((c) => c.programId === programId);

  // NFC tap: as soon as we know the visitor's card, start a request.
  useEffect(() => {
    if (tag && data && !nfcCardId && data.myCards.length > 0) setNfcCardId(data.myCards[0]!.id);
  }, [tag, data, nfcCardId]);

  const onJoined = useCallback(
    async (cardId: string) => {
      await qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["customer-session"] });
      if (tag) setNfcCardId(cardId);
      else navigate(`/c/cards/${cardId}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag, navigate, qc, slug],
  );

  if (isLoading) return <ShopPageSkeleton />;
  if (error || !data) return <NotFound />;
  const { business } = data;

  if (tag && nfcCardId) {
    return (
      <CustomerShell>
        <ShopHeader shop={data.business} />
        <NfcRequestPanel
          tagCode={tag}
          cardId={nfcCardId}
          onClose={() => {
            params.delete("tag");
            setParams(params, { replace: true });
            setNfcCardId(null);
          }}
        />
      </CustomerShell>
    );
  }

  return (
    <CustomerShell>
      <ShopHeader shop={data.business} />

      {params.get("link") === "expired" && (
        <div className="mt-4">
          <Alert tone="warning">The QR code or NFC tag you used is no longer active. You can still join or open your card here.</Alert>
        </div>
      )}
      {tag && data.myCards.length === 0 && data.programs.length > 0 && (
        <div className="mt-4">
          <Alert tone="info">Join below first — we'll then send your point request to the staff.</Alert>
        </div>
      )}

      {data.myCards.length === 0 && data.programs.length > 0 && <HowItWorksStrip />}

      <section className="mt-6 space-y-4">
        {data.programs.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center text-zinc-600 shadow-sm">This shop hasn't started a loyalty program yet.</div>
        ) : (
          data.programs.map((p) => {
            const mine = myCardFor(p.id);
            return (
              <ProgramOffer
                key={p.id}
                program={p}
                stamps={mine?.pointsBalance ?? 0}
                action={
                  mine ? (
                    <Link to={`/c/cards/${mine.id}`}>
                      <Button className="h-12 w-full text-base">Open my card</Button>
                    </Link>
                  ) : (
                    <JoinForm slug={slug} programId={p.id} businessName={business.name} customerName={data.customer?.name ?? null} onJoined={onJoined} />
                  )
                }
              />
            );
          })
        )}
      </section>

      <ShopContactRow name={business.name} links={business.links} slug={slug} />

      {data.reviewAssistant && (
        <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Share your experience</h2>
          <p className="mt-1 text-sm text-zinc-600">Tell others about your visit on Google. Optional — we'll help you put your thoughts into words.</p>
          <Link to={`/s/${slug}/review`}>
            <Button variant="secondary" className="mt-4 h-11 w-full">
              Share your experience
            </Button>
          </Link>
        </section>
      )}

      <p className="mt-8 text-center text-sm">
        <Link to="/c" className="text-brand-600 hover:underline">
          My loyalty cards
        </Link>
      </p>
    </CustomerShell>
  );
}

function JoinForm({
  slug,
  programId,
  businessName,
  customerName,
  onJoined,
}: {
  slug: string;
  programId: string;
  businessName: string;
  customerName: string | null;
  onJoined: (cardId: string) => void;
}) {
  const [captcha, setCaptcha] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setCaptcha(t), []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [registeredPhone, setRegisteredPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const session = useQuery({
    queryKey: ["customer-session"],
    queryFn: () => api<CustomerSession>("/api/c/session"),
    enabled: !!customerName,
  });
  const sessionPhone = session.data?.customer?.phone ?? null;
  // The API ignores name/phone for a signed-in customer, but still validates them, so send the real values.
  const signedIn = !!customerName && !!sessionPhone;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const month = String(f.get("bmonth") ?? "");
    const day = String(f.get("bday") ?? "");
    const phone = String(f.get("phone") ?? "").trim();
    const body = {
      slug,
      programId,
      name: signedIn ? customerName : String(f.get("name")).trim(),
      phone: signedIn ? sessionPhone : phone,
      birthday: month && day ? `${month}-${day}` : null,
      whatsappConsent: f.get("whatsapp") === "on",
    };
    setLoading(true);
    setErrors({});
    setError(null);
    setRegisteredPhone(null);
    try {
      const res = await fetch("/api/c/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...captchaHeaders(captcha) },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const err = json?.error ?? {};
        if (err.code === "PHONE_REGISTERED") {
          setRegisteredPhone(phone);
          return;
        }
        throw new ApiError(res.status, err.code ?? "UNKNOWN", err.message ?? "Could not join", err.details);
      }
      onJoined(json.cardId);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setError(err.status === 429 ? "Too many attempts. Please wait a minute." : err.message);
      } else setError("No internet connection. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button className="h-12 w-full text-base" onClick={() => setOpen(true)}>
        {signedIn ? "Add this card" : "Join — it's free"}
      </Button>
    );
  }

  if (registeredPhone) {
    return (
      <div className="space-y-3">
        <Alert tone="info">This number already has a loyalty card. Verify it with a one-time code to open it.</Alert>
        <Link to={`/c/login?phone=${encodeURIComponent(registeredPhone)}&next=${encodeURIComponent(`/s/${slug}${location.search}`)}`}>
          <Button className="h-12 w-full text-base">Verify my number</Button>
        </Link>
        <Button variant="ghost" className="w-full" onClick={() => setRegisteredPhone(null)}>
          Use a different number
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {signedIn ? (
        <p className="text-sm text-zinc-600">Joining as {customerName}.</p>
      ) : (
        <>
          <Input label="Your name" name="name" required minLength={2} maxLength={80} autoComplete="name" className="h-12 text-base" error={errors.name} />
          <Input
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="tel"
            required
            autoComplete="tel-national"
            placeholder="98765 43210"
            className="h-12 text-base"
            error={errors.phone}
          />
        </>
      )}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-zinc-700">Birthday (optional — for a birthday treat)</legend>
        <div className="grid grid-cols-2 gap-2">
          <Select name="bday" defaultValue="" aria-label="Birthday day" className="h-12 text-base">
            <option value="">Day</option>
            {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
              <option key={d} value={d}>
                {Number(d)}
              </option>
            ))}
          </Select>
          <Select name="bmonth" defaultValue="" aria-label="Birthday month" className="h-12 text-base">
            <option value="">Month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1).padStart(2, "0")}>
                {m}
              </option>
            ))}
          </Select>
        </div>
        {errors.birthday && <p className="mt-1 text-xs text-red-600">{errors.birthday}</p>}
      </fieldset>
      <label className="flex items-start gap-3 text-sm text-zinc-700">
        <input type="checkbox" name="whatsapp" className="mt-0.5 size-5 shrink-0 rounded border-zinc-300 accent-brand-500" />
        <span>Send me offers from {businessName} on WhatsApp. You can stop anytime.</span>
      </label>
      <Turnstile onToken={onToken} />
      <Button type="submit" className="h-12 w-full text-base" loading={loading} disabled={!!TURNSTILE_SITE_KEY && !captcha && !signedIn}>
        Get my card
      </Button>
      <p className="text-center text-xs text-zinc-500">We use your number only for your loyalty card. No spam.</p>
    </form>
  );
}

function NfcRequestPanel({ tagCode, cardId, onClose }: { tagCode: string; cardId: string; onClose: () => void }) {
  const [request, setRequest] = useState<NfcRequestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<{ request: NfcRequestStatus }>("/api/c/nfc-requests", { body: { tagCode, cardId } })
      .then((r) => setRequest(r.request))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not send your request"));
  }, [tagCode, cardId]);

  const pending = request?.status === "pending";
  useEffect(() => {
    if (!request || !pending) return;
    const poll = setInterval(async () => {
      try {
        const r = await api<{ request: NfcRequestStatus }>(`/api/c/nfc-requests/${request.id}`);
        setRequest(r.request);
      } catch {
        /* transient; keep polling */
      }
    }, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [request?.id, pending]);

  const left = request ? Math.max(0, Math.round((new Date(request.expiresAt).getTime() - now) / 1000)) : 0;
  const status = pending && left === 0 ? "expired" : request?.status;

  return (
    <div className="mt-8 rounded-3xl bg-white p-6 text-center shadow-lg">
      {error ? (
        <>
          <p className="text-4xl">⚠️</p>
          <p className="mt-3 font-medium">{error}</p>
          <Link to={`/c/cards/${cardId}`}>
            <Button className="mt-6 h-12 w-full text-base">Show my card QR instead</Button>
          </Link>
        </>
      ) : !request ? (
        <div className="flex justify-center py-10 text-zinc-400">
          <Spinner className="size-8" />
        </div>
      ) : status === "pending" ? (
        <>
          <p className="text-zinc-600">Show this code to the staff</p>
          <p className="my-4 font-mono text-6xl font-bold tracking-[0.3em] text-brand-600" aria-live="polite">
            {request.shortCode}
          </p>
          <p className="flex items-center justify-center gap-2 text-sm text-zinc-500">
            <Spinner className="size-4" /> Waiting for approval · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </p>
        </>
      ) : status === "approved" ? (
        <>
          <p className="text-5xl">🎉</p>
          <p className="mt-3 text-xl font-semibold">Point added!</p>
          <Link to={`/c/cards/${cardId}`}>
            <Button className="mt-6 h-12 w-full text-base">See my card</Button>
          </Link>
        </>
      ) : (
        <>
          <p className="text-4xl">{status === "expired" ? "⏱️" : "✋"}</p>
          <p className="mt-3 font-medium">
            {status === "expired" ? "The request timed out." : `The staff didn't approve this request${request.failureReason === "DAILY_LIMIT" ? " — you've already collected today's points" : ""}.`}
          </p>
          <Link to={`/c/cards/${cardId}`}>
            <Button className="mt-6 h-12 w-full text-base">Show my card QR instead</Button>
          </Link>
        </>
      )}
      <button className="mt-4 text-sm text-zinc-500 hover:underline" onClick={onClose}>
        Back to shop page
      </button>
    </div>
  );
}
