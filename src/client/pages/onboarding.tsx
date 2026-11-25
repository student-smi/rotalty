import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type Business } from "../lib/api";
import { useMe } from "../lib/queries";
import { CATEGORY_LABELS } from "../lib/labels";
import { Logo } from "../lib/brand";
import { STAMP_ICONS, stampEmoji, type StampIcon } from "../lib/loyalty-api";
import { BUSINESS_CATEGORIES, type BusinessCategory } from "../../shared/permissions";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { QrCode } from "../components/QrCode";
import { defaultPosterText, downloadCanvas, renderPoster, safeFileName } from "../lib/poster";
import type { Program } from "../lib/loyalty-api";
import { Alert, Button, cx, Input, Select } from "../components/ui";
import { PlaceFoundCard, PlaceSearch, usePlacesEnabled, type PlaceDetails } from "../components/PlaceSearch";
import { ReviewKeywordsEditor, saveReviewKeywords } from "../components/ReviewKeywordsEditor";
import type { ReviewKeyword, ReviewSettings } from "../lib/review-api";
import { TEMPLATES } from "../lib/card-templates";

type Created = Pick<Business, "id" | "name" | "slug" | "category">;

const STEPS = ["Your shop", "Stamp card", "Google reviews", "QR poster"];

export function OnboardingPage() {
  const me = useMe();
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState<Created | null>(null);
  const hasOther = (me.data?.memberships.length ?? 0) > 0;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 to-zinc-50">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5">
        <Logo />
        {hasOther && !business && (
          <Link to="/app" className="text-sm text-zinc-500 hover:text-zinc-800">
            Cancel
          </Link>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <Stepper step={step} />
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-8">
          {step === 0 && (
            <ShopStep
              onDone={(b) => {
                setBusiness(b);
                setStep(1);
              }}
            />
          )}
          {step === 1 && business && <CardStep business={business} onDone={() => setStep(2)} />}
          {step === 2 && business && <ReviewStep business={business} onDone={() => setStep(3)} />}
          {step === 3 && business && <PosterStep business={business} />}
        </div>
      </main>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Setup progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span
            className={cx(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-500 text-white" : "bg-white text-zinc-400 ring-1 ring-zinc-200",
            )}
            aria-current={i === step ? "step" : undefined}
          >
            {i < step ? "✓" : i + 1}
          </span>
          <span className={cx("hidden text-sm font-medium sm:block", i === step ? "text-zinc-900" : "text-zinc-500")}>{label}</span>
          {i < STEPS.length - 1 && <span className={cx("h-0.5 flex-1 rounded", i < step ? "bg-emerald-400" : "bg-zinc-200")} />}
        </li>
      ))}
    </ol>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-zinc-600">{subtitle}</p>
    </div>
  );
}

type ShopFields = { name: string; category: BusinessCategory; phone: string; addressLine: string; city: string; state: string; pincode: string };
const EMPTY_SHOP: ShopFields = { name: "", category: "cafe", phone: "", addressLine: "", city: "", state: "", pincode: "" };

function ShopStep({ onDone }: { onDone: (b: Created) => void }) {
  const qc = useQueryClient();
  const placesEnabled = usePlacesEnabled();
  const [fields, setFields] = useState<ShopFields>(() => {
    try {
      const name = sessionStorage.getItem("repeatly.prefillShop");
      if (name) {
        sessionStorage.removeItem("repeatly.prefillShop");
        return { ...EMPTY_SHOP, name };
      }
    } catch {
      // Private mode: start empty.
    }
    return EMPTY_SHOP;
  });
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const [showAddress, setShowAddress] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof ShopFields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [k]: e.target.value }));

  function applyPlace(p: PlaceDetails) {
    setPlace(p);
    setShowAddress(true);
    setErrors({});
    setFields({
      name: p.name,
      category: p.category,
      phone: p.phone ?? "",
      addressLine: p.addressLine ?? "",
      city: p.city ?? "",
      state: p.state ?? "",
      pincode: p.pincode ?? "",
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = {
      ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.trim()])),
      ...(place ? { googlePlaceId: place.placeId, latitude: place.latitude, longitude: place.longitude } : {}),
    };
    setLoading(true);
    setErrors({});
    setError(null);
    try {
      const { business } = await api<{ business: Business }>("/api/businesses", { body });
      await qc.invalidateQueries({ queryKey: ["me"] });
      onDone(business);
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors();
        setErrors(fe);
        if (fe.addressLine || fe.state || fe.pincode) setShowAddress(true);
        setError(err.code === "PLAN_LIMIT_REACHED" ? err.message : Object.keys(fe).length ? null : err.message);
      } else setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <StepHeading
        title="Tell us about your shop"
        subtitle={placesEnabled ? "Search your shop on Google and we'll fill in the details for you. You can change anything later." : "This is what customers see when they scan your QR. You can change it later."}
      />
      {error && <Alert>{error}</Alert>}
      {placesEnabled && (
        <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-4">
          {place ? (
            <PlaceFoundCard
              place={place}
              onClear={() => {
                setPlace(null);
                setFields(EMPTY_SHOP);
                setShowAddress(false);
              }}
            />
          ) : (
            <>
              <PlaceSearch onPick={applyPlace} autoFocus />
              <p className="mt-2 text-xs text-zinc-500">Not on Google Maps yet? No problem, just fill in the form below.</p>
            </>
          )}
        </div>
      )}
      <Input label="Shop name" name="name" value={fields.name} onChange={set("name")} required minLength={2} maxLength={80} placeholder="e.g. Sharma Chai Point" error={errors.name} autoFocus={!placesEnabled} />
      <Select label="What kind of business?" name="category" value={fields.category} onChange={set("category")} error={errors.category}>
        {BUSINESS_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABELS[c]}
          </option>
        ))}
      </Select>
      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          label="Shop mobile (optional)"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="98765 43210"
          value={fields.phone}
          onChange={set("phone")}
          error={errors.phone}
          hint={place && !place.phone && place.phoneDisplay ? `Google lists ${place.phoneDisplay}. Add a 10-digit mobile for WhatsApp.` : undefined}
        />
        <Input label="City (optional)" name="city" value={fields.city} onChange={set("city")} placeholder="Ahmedabad" error={errors.city} />
      </div>
      {showAddress ? (
        <div className="space-y-5">
          <Input label="Address" name="addressLine" value={fields.addressLine} onChange={set("addressLine")} maxLength={200} error={errors.addressLine} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Input label="State" name="state" value={fields.state} onChange={set("state")} error={errors.state} />
            <Input label="PIN code" name="pincode" inputMode="numeric" maxLength={6} value={fields.pincode} onChange={set("pincode")} error={errors.pincode} />
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setShowAddress(true)} className="text-sm font-medium text-brand-600 hover:underline">
          + Add full address (optional)
        </button>
      )}
      <div className="flex justify-end pt-2">
        <Button type="submit" loading={loading} className="h-11 px-6">
          Continue
        </Button>
      </div>
    </form>
  );
}

function CardStep({ business, onDone }: { business: Created; onDone: () => void }) {
  const qc = useQueryClient();
  const t = TEMPLATES[business.category] ?? TEMPLATES.other;
  const [name, setName] = useState(t.programName);
  const [stamps, setStamps] = useState(t.stamps);
  const [reward, setReward] = useState(t.reward);
  const [icon, setIcon] = useState<StampIcon>(t.icon);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function create() {
    setLoading(true);
    setError(null);
    try {
      await api(`/api/businesses/${business.id}/programs`, {
        body: {
          name: name.trim(),
          description: `Collect ${stamps} stamps, get ${reward.trim().toLowerCase()}.`,
          stampIcon: icon,
          stampsRequired: stamps,
          rewards: [{ name: reward.trim(), pointsRequired: stamps }],
        },
      });
      await qc.invalidateQueries({ queryKey: ["programs", business.id] });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the card. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const valid = name.trim().length >= 2 && reward.trim().length >= 2;

  return (
    <div>
      <StepHeading
        title="Create your stamp card"
        subtitle={
          <>
            We’ve filled in a popular offer for {CATEGORY_LABELS[business.category].toLowerCase()}s. Change anything you like.
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-5">
          <Input label="Card name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <div>
            <label htmlFor="stamps" className="flex items-center justify-between text-sm font-medium text-zinc-700">
              Stamps needed for the reward <span className="text-lg font-bold text-brand-600">{stamps}</span>
            </label>
            <input
              id="stamps"
              type="range"
              min={3}
              max={20}
              value={stamps}
              onChange={(e) => setStamps(Number(e.target.value))}
              className="mt-2 w-full accent-brand-500"
            />
            <p className="mt-1 text-xs text-zinc-500">One stamp per visit. Customers usually love 5–10.</p>
          </div>
          <Input label="Reward" value={reward} onChange={(e) => setReward(e.target.value)} maxLength={80} hint="What the customer gets when the card is full" />
          <fieldset>
            <legend className="text-sm font-medium text-zinc-700">Stamp icon</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {STAMP_ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  aria-pressed={icon === i}
                  aria-label={i}
                  className={cx(
                    "flex size-11 items-center justify-center rounded-xl text-xl transition",
                    icon === i ? "bg-brand-50 ring-2 ring-brand-500" : "bg-zinc-50 ring-1 ring-zinc-200 hover:bg-zinc-100",
                  )}
                >
                  {stampEmoji(i)}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-zinc-700">Preview — what customers see</p>
          <LoyaltyCard
            businessName={business.name}
            programName={name || "Loyalty card"}
            customerName="Your customer"
            stampIcon={icon}
            stampsRequired={stamps}
            points={Math.min(3, stamps - 1)}
            rewards={[{ name: reward || "Reward", pointsRequired: stamps }]}
          />
          <p className="mt-3 text-sm text-zinc-500">
            Offer: <strong className="text-zinc-800">collect {stamps} stamps → {reward || "reward"}</strong>. You can add more reward levels, dates and terms later in Loyalty Programs.
          </p>
        </div>
      </div>
      <div className="mt-8 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick={onDone} className="text-sm text-zinc-500 hover:text-zinc-800">
          Skip — I’ll do this later
        </button>
        <Button onClick={create} loading={loading} disabled={!valid} className="h-11 px-6">
          Create card & continue
        </Button>
      </div>
    </div>
  );
}

function ReviewStep({ business, onDone }: { business: Created; onDone: () => void }) {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["review-settings", business.id],
    queryFn: () => api<{ settings: ReviewSettings }>(`/api/businesses/${business.id}/review-settings`),
  });
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [editLink, setEditLink] = useState(false);
  const [keywords, setKeywords] = useState<ReviewKeyword[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const link = reviewUrl ?? settings.data?.settings.reviewUrl ?? "";

  async function turnOn() {
    const s = settings.data?.settings;
    if (!s) return;
    setSaving(true);
    setError(null);
    try {
      await saveReviewKeywords(business.id, keywords);
      await api(`/api/businesses/${business.id}/review-settings`, {
        method: "PUT",
        body: { ...s, enabled: true, reviewUrl: link, profileName: s.profileName ?? business.name, showOnCard: true },
      });
      await qc.invalidateQueries({ queryKey: ["review-settings", business.id] });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? (Object.values(err.fieldErrors())[0] ?? err.message) : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <StepHeading
        title="Get more Google reviews"
        subtitle="Customers see a ⭐ button under their stamp card. They tap what they liked, and AI helps them write an honest review in their language."
      />
      {error && <Alert>{error}</Alert>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">1. Your Google review link</h2>
        {settings.isLoading ? (
          <div className="h-12 animate-pulse rounded-xl bg-zinc-100" />
        ) : link && !editLink ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">✓</span>
            <p className="min-w-0 flex-1 text-emerald-900">Linked to your Google listing</p>
            <button type="button" onClick={() => setEditLink(true)} className="text-xs font-medium text-emerald-800 hover:underline">
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-brand-100 bg-brand-50/50 p-3">
            <PlaceSearch
              label="Find your shop on Google"
              placeholder="Search your shop on Google Maps"
              onPick={(p) => {
                setReviewUrl(p.reviewUrl);
                setEditLink(false);
              }}
            />
            <Input
              label="Or paste your review link"
              placeholder="https://g.page/r/…/review"
              value={link}
              onChange={(e) => setReviewUrl(e.target.value)}
              hint="Google Business Profile → Ask for reviews → copy link"
            />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-900">2. Keywords customers can pick</h2>
        <ReviewKeywordsEditor businessId={business.id} selected={keywords} onChange={setKeywords} autoSuggest />
      </section>

      <section className="rounded-xl bg-zinc-50 p-4 text-xs leading-relaxed text-zinc-600">
        <p className="font-semibold text-zinc-800">How this stays within Google's rules</p>
        <p className="mt-1">
          Every customer sees the same button, whether they're happy or not. Customers pick only what they really experienced, can edit the text, and post it themselves.
          No stamps or rewards are given for reviews.
        </p>
      </section>

      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={onDone}>
          Skip for now
        </Button>
        <Button className="h-11 px-6" loading={saving} onClick={turnOn} disabled={!link || keywords.length === 0 || settings.isLoading}>
          Turn on Google reviews
        </Button>
      </div>
    </div>
  );
}

function PosterStep({ business }: { business: Created }) {
  const navigate = useNavigate();
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pageUrl = `${window.location.origin}/s/${business.slug}`;

  async function makePoster() {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ qrCode: { url: string } }>(`/api/businesses/${business.id}/qr-codes`, { body: { label: "Counter poster" } });
      setQrUrl(res.qrCode.url);
      const { programs } = await api<{ programs: Program[] }>(`/api/businesses/${business.id}/programs`);
      const reward = programs.find((p) => p.status === "active")?.rewards.filter((r) => r.isActive).sort((a, b) => a.pointsRequired - b.pointsRequired).at(-1);
      const text = defaultPosterText(business.name, reward ? { stamps: reward.pointsRequired, reward: reward.name } : null);
      const canvas = await renderPoster({ format: "poster", theme: "brand", qrValue: res.qrCode.url, businessName: business.name, logoUrl: null, ...text, showSteps: true });
      downloadCanvas(canvas, `${safeFileName(business.name)}-poster.png`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the poster. You can do it later from QR & NFC.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-center">
      <StepHeading
        title="You’re ready! 🎉"
        subtitle="Print this QR and place it near your billing counter. Customers scan it to get their card."
      />
      {error && (
        <div className="mb-4 text-left">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mx-auto w-fit rounded-2xl border border-zinc-200 p-5">
        <p className="font-semibold">{business.name}</p>
        <QrCode value={qrUrl ?? pageUrl} size={200} className="mx-auto mt-3" label={`${business.name} loyalty QR`} />
        <p className="mt-3 text-sm text-zinc-500">Scan to join our loyalty card</p>
      </div>
      <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3">
        <Button onClick={makePoster} loading={loading} className="h-11">
          {qrUrl ? "Download poster again" : "Download QR poster"}
        </Button>
        <Button variant="secondary" className="h-11" onClick={() => navigate(`/app/b/${business.id}`, { replace: true })}>
          Go to my dashboard
        </Button>
      </div>
      <div className="mx-auto mt-8 max-w-md rounded-2xl bg-zinc-50 p-4 text-left text-sm text-zinc-600">
        <p className="font-medium text-zinc-800">What happens next</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>A customer scans the poster and joins with their mobile number.</li>
          <li>At billing, open <strong>Scan & Issue</strong> on your phone and scan the QR on their card.</li>
          <li>When the card is full, scan again and tap <strong>Redeem</strong>.</li>
        </ol>
        <p className="mt-3">
          Tip: try it yourself first —{" "}
          <a href={pageUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
            open your customer page
          </a>
          .
        </p>
      </div>
    </div>
  );
}
