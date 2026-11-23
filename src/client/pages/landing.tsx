import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { authClient } from "../lib/auth";
import { BRAND, Logo } from "../lib/brand";
import { formatINR } from "../lib/billing-format";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { Button, cx } from "../components/ui";
import type { PlanLimits } from "../../shared/domain";

interface PublicPlan {
  code: string;
  name: string;
  description: string | null;
  pricePaise: number;
  intervalDays: number;
  limits: PlanLimits;
}

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function LandingPage() {
  const session = authClient.useSession();
  const signedIn = !!session.data;
  const [menu, setMenu] = useState(false);

  const primaryCta = signedIn ? (
    <Link to="/app">
      <Button className="h-12 px-6 text-base">Go to my dashboard</Button>
    </Link>
  ) : (
    <Link to="/signup">
      <Button className="h-12 px-6 text-base">Start free — no card needed</Button>
    </Link>
  );

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label={`${BRAND} home`}>
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-zinc-600 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="hover:text-zinc-900">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {signedIn ? (
              <Link to="/app">
                <Button>Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost">Log in</Button>
                </Link>
                <Link to="/signup">
                  <Button>Start free</Button>
                </Link>
              </>
            )}
          </div>
          <button className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 md:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            <svg viewBox="0 0 20 20" className="size-6" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        {menu && (
          <div className="border-t border-zinc-100 bg-white px-4 py-3 md:hidden">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} onClick={() => setMenu(false)} className="block rounded-lg px-2 py-2.5 text-zinc-700 hover:bg-zinc-50">
                {n.label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {signedIn ? (
                <Link to="/app" className="col-span-2">
                  <Button className="w-full">Dashboard</Button>
                </Link>
              ) : (
                <>
                  <Link to="/login">
                    <Button variant="secondary" className="w-full">Log in</Button>
                  </Link>
                  <Link to="/signup">
                    <Button className="w-full">Start free</Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-brand-50 via-white to-white" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 md:grid-cols-2 md:pb-24 md:pt-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white px-3 py-1 text-xs font-medium text-brand-700">
              Made for Indian local shops
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Turn first-time buyers into <span className="text-brand-600">regular customers</span>.
            </h1>
            <p className="mt-5 text-lg text-zinc-600">
              Digital stamp cards, honest Google reviews and WhatsApp reminders — all from one simple dashboard. Customers just scan a QR. No app to install.
            </p>
            <p className="mt-2 text-base text-zinc-500">Grahak wapas aaye, baar baar — bina kisi app ke.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {primaryCta}
              <a href="#how">
                <Button variant="secondary" className="h-12 px-6 text-base">See how it works</Button>
              </a>
            </div>
            <ul className="mt-8 grid gap-2 text-sm text-zinc-600 sm:grid-cols-3">
              {["Set up in 5 minutes", "Works on every phone", "Free plan forever"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check /> {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* Business types */}
      <section className="border-y border-zinc-100 bg-zinc-50/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 text-sm text-zinc-500 sm:px-6">
          <span className="font-medium text-zinc-700">Built for</span>
          {["☕ Cafés", "🍽️ Restaurants", "🧃 Juice shops", "✂️ Salons", "🎂 Bakeries", "🍬 Sweet shops", "🏋️ Gyms", "🛍️ Retail"].map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>
      </section>

      <HowItWorks />
      <Features />
      <ReviewDemo />
      <Pricing />
      <Faq />

      {/* Final CTA */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-400 px-6 py-12 text-center text-white sm:px-12 sm:py-16">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Your next regular customer is walking in today.</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85">Create your loyalty card, print the QR and start stamping in minutes.</p>
          <div className="mt-8 flex justify-center">
            <Link to={signedIn ? "/app" : "/signup"}>
              <Button variant="secondary" className="h-12 px-6 text-base">
                {signedIn ? "Go to my dashboard" : "Create my free account"}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-zinc-500 sm:flex-row sm:px-6">
          <Logo />
          <div className="flex flex-wrap justify-center gap-5">
            <Link to="/c" className="hover:text-zinc-800">My loyalty cards</Link>
            <Link to="/login" className="hover:text-zinc-800">Shop login</Link>
            <a href="#faq" className="hover:text-zinc-800">FAQ</a>
            <Link to="/support" className="hover:text-zinc-800">Support</Link>
            <Link to="/privacy" className="hover:text-zinc-800">Privacy</Link>
            <Link to="/terms" className="hover:text-zinc-800">Terms</Link>
          </div>
          <p>© {new Date().getFullYear()} {BRAND}</p>
        </div>
      </footer>
    </div>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cx("size-4 shrink-0 text-emerald-500", className)} fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
    </svg>
  );
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-lg text-zinc-600">{subtitle}</p>}
    </div>
  );
}

/** Phone mock-up showing a sample card. Clearly a demo — no real customer data. */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-brand-100 to-indigo-50 blur-2xl" />
      <div className="rounded-[2.5rem] border border-zinc-200 bg-zinc-900 p-3 shadow-2xl">
        <div className="overflow-hidden rounded-[2rem] bg-zinc-50">
          <div className="flex items-center justify-between px-5 pb-2 pt-4 text-[11px] font-medium text-zinc-500">
            <span>9:41</span>
            <span className="h-4 w-16 rounded-full bg-zinc-900" />
            <span>5G</span>
          </div>
          <div className="space-y-4 px-4 pb-6">
            <LoyaltyCard
              businessName="Chai Point (demo)"
              programName="Chai lover card"
              customerName="Riya"
              stampIcon="coffee"
              stampsRequired={10}
              points={7}
              rewards={[{ name: "Free masala chai", pointsRequired: 10 }]}
            />
            <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-zinc-100">
              <DemoQr />
              <p className="mt-2 text-sm font-medium">Show this at the counter</p>
              <p className="text-xs text-zinc-500">Code refreshes every minute</p>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -left-4 top-1/3 hidden rounded-2xl bg-white px-4 py-3 shadow-lg ring-1 ring-zinc-100 sm:block">
        <p className="text-xs text-zinc-500">Staff scanned</p>
        <p className="text-sm font-semibold text-emerald-600">+1 stamp added ☕</p>
      </div>
      <div className="absolute -right-4 bottom-10 hidden rounded-2xl bg-white px-4 py-3 shadow-lg ring-1 ring-zinc-100 sm:block">
        <p className="text-xs text-zinc-500">3 more visits</p>
        <p className="text-sm font-semibold">🎁 Free chai unlocked soon</p>
      </div>
    </div>
  );
}

/** Decorative QR-like pattern (not scannable on purpose). */
function DemoQr() {
  const cells = Array.from({ length: 121 }, (_, i) => ((i * 7919) % 13) % 3 !== 0);
  return (
    <div className="mx-auto grid size-28 grid-cols-11 gap-px rounded-lg bg-white p-1.5 ring-1 ring-zinc-200" aria-hidden>
      {cells.map((on, i) => {
        const r = Math.floor(i / 11);
        const c = i % 11;
        const finder = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
        return <span key={i} className={finder || on ? "rounded-[1px] bg-zinc-900" : ""} />;
      })}
    </div>
  );
}

function Step({ n, title, text, children }: { n: number; title: string; text: string; children?: ReactNode }) {
  return (
    <li className="relative rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <span className="flex size-9 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">{n}</span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-zinc-600">{text}</p>
      {children}
    </li>
  );
}

function HowItWorks() {
  const [tab, setTab] = useState<"shop" | "customer">("shop");
  const shop = [
    { title: "Create your account", text: "Add your shop name and category. Takes a minute." },
    { title: "Design your stamp card", text: "Pick a ready template like “Buy 9, get the 10th free” or make your own." },
    { title: "Print your QR poster", text: "Download it and stick it near the counter. Customers scan it to join." },
    { title: "Scan & reward", text: "On each visit, scan the customer’s card from your phone. Rewards unlock automatically." },
  ];
  const customer = [
    { title: "Scan the shop’s QR", text: "Opens in the phone’s browser. Nothing to download." },
    { title: "Join with mobile number", text: "Just name and number. The card is saved on the phone." },
    { title: "Show card at every visit", text: "Staff scan the card’s QR code and a stamp is added instantly." },
    { title: "Get your reward", text: "When the card is full, show it again and enjoy the free item." },
  ];
  const steps = tab === "shop" ? shop : customer;
  return (
    <section id="how" className="scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHeading eyebrow="How it works" title="Simple for you. Even simpler for your customers." />
      <div className="mx-auto mt-8 flex w-fit rounded-full bg-zinc-100 p-1" role="tablist">
        {(
          [
            ["shop", "For shop owners"],
            ["customer", "For customers"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cx("rounded-full px-5 py-2 text-sm font-medium transition", tab === key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800")}
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="mx-auto mt-10 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <Step key={s.title} n={i + 1} title={s.title} text={s.text} />
        ))}
      </ol>
      <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-zinc-500">
        Have an NFC sticker? Customers can also tap it with their phone — your staff approves the stamp with one tap.
      </p>
    </section>
  );
}

const FEATURES = [
  { icon: "🎟️", title: "Digital stamp cards", text: "Your logo, your offer. Multiple reward levels, expiry dates and terms — no paper cards to lose." },
  { icon: "📱", title: "QR & NFC collection", text: "Customers show a secure, auto-refreshing QR. Each code works once, so stamps can’t be faked or copied." },
  { icon: "⭐", title: "AI review helper", text: "Customers answer 5 quick questions; AI turns their words into a Google review draft in English, Hindi, Gujarati or Hinglish." },
  { icon: "👥", title: "Customer list (CRM)", text: "See who’s new, who’s loyal and who stopped coming. Search, filter and export anytime." },
  { icon: "💬", title: "WhatsApp automation", text: "Birthday wishes, “we miss you” offers and reward alerts — only to customers who said yes." },
  { icon: "📊", title: "Clear analytics", text: "Daily visits, returning customers, rewards redeemed and what’s working — at a glance." },
];

function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-zinc-50/70 px-4 py-20 sm:px-6">
      <SectionHeading eyebrow="Features" title="Everything to bring customers back" subtitle="One dashboard for your counter, your team and your growth." />
      <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-2xl" aria-hidden>
              {f.icon}
            </span>
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{f.text}</p>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-6 grid max-w-6xl gap-4 sm:grid-cols-3">
        {[
          ["🧑‍🍳", "Staff accounts", "Give cashiers only the access they need."],
          ["🏬", "Multiple outlets", "One account for all your branches."],
          ["🔒", "Your data, protected", "Customers control their consent and can delete their data."],
        ].map(([icon, title, text]) => (
          <div key={title} className="flex items-start gap-3 rounded-2xl p-4">
            <span className="text-xl" aria-hidden>{icon}</span>
            <div>
              <p className="font-medium">{title}</p>
              <p className="text-sm text-zinc-600">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewDemo() {
  return (
    <section className="px-4 py-20 sm:px-6">
      <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Google reviews</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Happy customers want to review you. We make it easy.</h2>
          <p className="mt-4 text-lg text-zinc-600">
            Most people don’t know what to write. Our helper asks a few simple questions and turns their own words into a ready draft — they edit it and post it themselves.
          </p>
          <ul className="mt-6 space-y-3 text-zinc-700">
            {[
              "Uses only what the customer said — nothing made up",
              "Keeps honest feedback honest, good or bad",
              "Never linked to points or rewards (Google’s rules)",
              "English, हिन्दी, ગુજરાતી and Hinglish",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Check className="mt-1" /> <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-3xl bg-zinc-50 p-5 ring-1 ring-zinc-100 sm:p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">Example</p>
          <div className="mt-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
            <p className="text-xs text-zinc-500">Customer’s answers</p>
            <p className="mt-1 text-sm">
              Masala chai & samosa · chai was great, samosa was cold · staff friendly · loved the ginger flavour
            </p>
          </div>
          <div className="my-3 flex justify-center text-zinc-300" aria-hidden>
            ↓
          </div>
          <div className="space-y-2">
            {[
              ["Short", "Chai was great with a strong ginger flavour, but the samosa was cold. Friendly staff."],
              ["Hinglish", "Maine masala chai aur samosa liya — chai ka ginger flavour bahut accha tha, lekin samosa thanda tha. Staff friendly thi."],
            ].map(([label, text]) => (
              <div key={label} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">{label}</span>
                <p className="mt-2 text-sm text-zinc-700">{text}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-zinc-500">Customer edits it, copies it and posts it on Google.</p>
        </div>
      </div>
    </section>
  );
}

function limitText(v: number | null, unit: string) {
  return v === null ? `Unlimited ${unit}` : `${v.toLocaleString("en-IN")} ${unit}`;
}

function Pricing() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-plans"],
    queryFn: () => api<{ plans: PublicPlan[] }>("/api/public/plans"),
    staleTime: 5 * 60_000,
  });
  return (
    <section id="pricing" className="scroll-mt-20 bg-zinc-50/70 px-4 py-20 sm:px-6">
      <SectionHeading eyebrow="Pricing" title="Start free. Upgrade when you grow." subtitle="Prices in ₹ per month. No hidden charges, cancel anytime." />
      {isLoading ? (
        <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-80 animate-pulse rounded-2xl bg-white ring-1 ring-zinc-100" />
          ))}
        </div>
      ) : error || !data ? (
        <p className="mt-10 text-center text-zinc-500">Pricing couldn’t load right now. Please refresh.</p>
      ) : (
        <div className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.plans.map((p) => {
            const popular = p.code === "starter";
            const l = p.limits;
            const items = [
              limitText(l.customersPerBusiness, "customers"),
              `${limitText(l.programsPerBusiness, "loyalty programs")}`,
              `${limitText(l.staffPerBusiness, "team members")}`,
              l.businesses && l.businesses > 1 ? `${l.businesses} businesses` : l.locationsPerBusiness && l.locationsPerBusiness > 1 ? `${l.locationsPerBusiness} outlets` : "1 outlet",
              `${limitText(l.aiGenerationsPerMonth, "AI review drafts / month")}`,
              l.marketing ? `${limitText(l.campaignMessagesPerMonth, "WhatsApp messages / month")}` : null,
              l.nfc ? "NFC tap-to-collect" : null,
              l.advancedAnalytics ? "Advanced analytics" : "Basic analytics",
            ].filter(Boolean) as string[];
            return (
              <div
                key={p.code}
                className={cx(
                  "relative flex flex-col rounded-2xl bg-white p-6 shadow-sm",
                  popular ? "ring-2 ring-brand-500" : "ring-1 ring-zinc-200",
                )}
              >
                {popular && (
                  <span className="absolute -top-3 left-6 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white">Most popular</span>
                )}
                <h3 className="font-semibold">{p.name}</h3>
                {p.description && <p className="mt-1 text-sm text-zinc-500">{p.description}</p>}
                <p className="mt-5">
                  <span className="text-3xl font-bold tracking-tight">{p.pricePaise === 0 ? "₹0" : formatINR(p.pricePaise)}</span>
                  <span className="text-sm text-zinc-500"> / month</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-sm text-zinc-700">
                  {items.map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <Check className="mt-0.5" /> {t}
                    </li>
                  ))}
                </ul>
                <Link to="/signup" className="mt-6">
                  <Button variant={popular ? "primary" : "secondary"} className="w-full">
                    {p.pricePaise === 0 ? "Start free" : `Start with ${p.name}`}
                  </Button>
                </Link>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-6 text-center text-sm text-zinc-500">Everyone starts on the Free plan. Upgrade from your dashboard whenever you need more.</p>
    </section>
  );
}

const FAQS: [string, string][] = [
  ["Do my customers need to download an app?", "No. Everything opens in the phone’s browser — Android or iPhone. Customers join with just their name and mobile number."],
  ["How do I add a stamp?", "Open “Scan & Issue” on your phone and scan the QR on the customer’s card. Or search the customer by mobile number if they forgot their phone."],
  ["Can a customer cheat by screenshotting their QR?", "No. The card’s QR changes every minute and each code works only once. Daily limits stop repeated stamping."],
  ["What is NFC and do I need it?", "NFC is a small sticker customers can tap with their phone instead of scanning. It’s optional — QR works for everyone. When someone taps, your staff approves the stamp."],
  ["Is the review helper allowed by Google?", "Yes, the way we built it: it’s offered to every customer, it’s never tied to points or discounts, it never posts anything itself, and it only uses the customer’s own words."],
  ["How do WhatsApp messages work?", "Messages go only to customers who opted in, using WhatsApp Business templates. Customers can reply STOP anytime. Requires connecting a WhatsApp Business account."],
  ["Is my customers’ data safe?", "Each shop sees only its own customers. Customers control their marketing consent and can delete their data anytime."],
  ["Can I try it before paying?", "Yes — the Free plan has no time limit and no card is needed. Upgrade only when you need more customers or features."],
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHeading eyebrow="FAQ" title="Questions shop owners ask us" />
      <div className="mx-auto mt-10 max-w-3xl divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white">
        {FAQS.map(([q, a]) => (
          <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
              {q}
              <span className="text-zinc-400 transition group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-2 text-zinc-600">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
