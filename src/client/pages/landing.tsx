import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { authClient } from "../lib/auth";
import { BRAND, Logo } from "../lib/brand";
import { formatINR } from "../lib/billing-format";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { Button, cx } from "../components/ui";
import { ScrollReveal, ScrollProgressBar } from "../components/ScrollReveal";
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
  { href: "#reviews", label: "Google Reviews" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

export function LandingPage() {
  const session = authClient.useSession();
  const signedIn = !!session.data;
  const [menu, setMenu] = useState(false);

  const primaryCta = signedIn ? (
    <Link to="/app">
      <Button className="h-12 px-6 text-base shadow-lg shadow-brand-500/20">Go to my dashboard</Button>
    </Link>
  ) : (
    <Link to="/signup">
      <Button className="h-12 px-6 text-base shadow-lg shadow-brand-500/20">Start free — no card needed</Button>
    </Link>
  );

  return (
    <div className="min-h-dvh bg-white text-zinc-900 selection:bg-brand-500 selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label={`${BRAND} home`}>
            <Logo />
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-zinc-600 md:flex">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="transition-colors hover:text-brand-600">
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
          <button
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 md:hidden"
            onClick={() => setMenu((m) => !m)}
            aria-label="Menu"
            aria-expanded={menu}
          >
            <svg viewBox="0 0 20 20" className="size-6" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <ScrollProgressBar />
        {menu && (
          <div className="border-t border-zinc-100 bg-white px-4 py-3 md:hidden">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setMenu(false)}
                className="block rounded-lg px-2 py-2.5 text-zinc-700 hover:bg-zinc-50"
              >
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
                    <Button variant="secondary" className="w-full">
                      Log in
                    </Button>
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
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-gradient-to-b from-brand-50/70 via-indigo-50/30 to-white" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 md:grid-cols-2 md:pb-24 md:pt-20">
          <ScrollReveal direction="up" delay={50} distance={36}>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-200/80 bg-white px-3.5 py-1 text-xs font-semibold text-brand-700 shadow-sm">
              <span className="flex size-2 rounded-full bg-emerald-500 animate-pulse" />
              Made for Indian Local Shops & Cafes
            </div>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl md:text-5xl lg:text-[3.25rem]">
              Turn first-time buyers into <span className="text-brand-600 bg-gradient-to-r from-brand-600 to-indigo-600 bg-clip-text text-transparent">regular customers</span>.
            </h1>
            <p className="mt-5 text-lg text-zinc-600 leading-relaxed">
              Digital stamp cards, honest Google reviews and free WhatsApp reminders — all from one simple dashboard. Customers just scan a counter QR. <strong className="font-semibold text-zinc-800">No app to download.</strong>
            </p>
            <p className="mt-2 text-base font-medium text-brand-700/90">Grahak wapas aaye, baar baar — bina kisi app ke.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {primaryCta}
              <a href="#how">
                <Button variant="secondary" className="h-12 px-6 text-base">
                  See how it works
                </Button>
              </a>
            </div>
            <ul className="mt-8 grid gap-2 text-sm font-medium text-zinc-600 sm:grid-cols-3">
              {["Set up in 5 minutes", "Works on every phone", "Free plan forever"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check /> {t}
                </li>
              ))}
            </ul>
          </ScrollReveal>

          <ScrollReveal direction="scale" delay={150} distance={20}>
            <HeroVisual />
          </ScrollReveal>
        </div>
      </section>

      {/* Business types */}
      <section className="border-y border-zinc-100 bg-zinc-50/70">
        <ScrollReveal direction="up" delay={100} distance={20}>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 text-sm text-zinc-500 sm:px-6">
            <span className="font-semibold text-zinc-800">Perfect for:</span>
            {["☕ Cafés", "🍽️ Restaurants", "🧃 Juice shops", "✂️ Salons & Spas", "🎂 Bakeries", "🍬 Sweet shops", "🏋️ Gyms", "🛍️ Boutiques"].map((x) => (
              <span key={x} className="rounded-md bg-white px-2.5 py-1 text-zinc-700 shadow-xs ring-1 ring-zinc-200/60 font-medium">
                {x}
              </span>
            ))}
          </div>
        </ScrollReveal>
      </section>

      <HowItWorks />

      {/* Visual Showcase: Physical Counter & Smart Tap */}
      <section className="border-t border-zinc-100 bg-gradient-to-b from-white via-zinc-50/60 to-white px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <ScrollReveal direction="up">
            <SectionHeading
              eyebrow="Real-World Counter Setup"
              title="Looks beautiful on your counter. Takes zero training."
              subtitle="Whether you use a printed acrylic QR standee or an NFC smart tag, stamping is 1-second fast."
            />
          </ScrollReveal>

          <div className="mt-14 grid gap-8 md:grid-cols-2">
            <ScrollReveal direction="up" delay={100}>
              <div className="group overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-3 shadow-md transition-all hover:shadow-xl">
                <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-zinc-100">
                  <img
                    src="/images/hero-counter-qr.jpg"
                    alt="Customer scanning QR code at modern cafe counter"
                    className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <span className="rounded-full bg-brand-500/90 px-3 py-1 text-xs font-semibold backdrop-blur">
                      Scan to Collect
                    </span>
                    <h3 className="mt-2 text-lg font-bold">Printed Counter QR Standee</h3>
                    <p className="mt-0.5 text-xs text-white/80">
                      Download from dashboard, print on A4/A5, and place on counter. No hardware required.
                    </p>
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-sm text-zinc-600">
                    Customers simply point their camera — opens instantly in Chrome or Safari without app installation.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            <ScrollReveal direction="up" delay={200}>
              <div className="group overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-3 shadow-md transition-all hover:shadow-xl">
                <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-zinc-100">
                  <img
                    src="/images/feature-nfc-tap.jpg"
                    alt="Smartphone tapping NFC smart tag on counter"
                    className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <span className="rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-semibold backdrop-blur">
                      NFC Contactless
                    </span>
                    <h3 className="mt-2 text-lg font-bold">One-Tap Smart NFC Tags</h3>
                    <p className="mt-0.5 text-xs text-white/80">
                      Tap-and-go experience with Google Wallet integration. Works on any modern Android & iPhone.
                    </p>
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-sm text-zinc-600">
                    Just tap the phone on your counter puck. Staff sees a 1-tap confirmation in their scanner view.
                  </p>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      <Features />
      <ReviewDemo />
      <Pricing />
      <Faq />

      {/* Final CTA */}
      <section className="px-4 pb-20 sm:px-6">
        <ScrollReveal direction="scale" delay={100}>
          <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-600 px-6 py-14 text-center text-white shadow-2xl sm:px-12 sm:py-18">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
              Your next regular customer is walking in today.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/90">
              Create your loyalty card, print your free QR standee, and start rewarding repeat visits in 5 minutes.
            </p>
            <div className="mt-8 flex justify-center">
              <Link to={signedIn ? "/app" : "/signup"}>
                <Button variant="secondary" className="h-13 px-8 text-base font-semibold shadow-xl">
                  {signedIn ? "Go to my dashboard" : "Create my free account"}
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-white/70">No credit card required · Free plan forever · 5-minute setup</p>
          </div>
        </ScrollReveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-zinc-500 sm:flex-row sm:px-6">
          <Logo />
          <div className="flex flex-wrap justify-center gap-6">
            <Link to="/c" className="hover:text-zinc-800 transition-colors">
              My loyalty cards
            </Link>
            <Link to="/login" className="hover:text-zinc-800 transition-colors">
              Shop login
            </Link>
            <a href="#faq" className="hover:text-zinc-800 transition-colors">
              FAQ
            </a>
            <Link to="/support" className="hover:text-zinc-800 transition-colors">
              Support
            </Link>
            <Link to="/privacy" className="hover:text-zinc-800 transition-colors">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-zinc-800 transition-colors">
              Terms
            </Link>
          </div>
          <p>© {new Date().getFullYear()} {BRAND}. Built for local businesses.</p>
        </div>
      </footer>
    </div>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cx("size-4 shrink-0 text-emerald-500", className)} fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl text-zinc-900">{title}</h2>
      {subtitle && <p className="mt-3 text-lg text-zinc-600">{subtitle}</p>}
    </div>
  );
}

/** Phone mock-up with floating badges and subtle micro-animations */
function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-6 -z-10 rounded-[3rem] bg-gradient-to-tr from-brand-200/50 via-indigo-100/50 to-brand-50 blur-2xl" />
      <div className="rounded-[2.5rem] border border-zinc-200/90 bg-zinc-900 p-3 shadow-2xl ring-1 ring-zinc-950/10">
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
            <div className="rounded-2xl bg-white p-4 text-center shadow-xs ring-1 ring-zinc-100">
              <DemoQr />
              <p className="mt-2 text-sm font-semibold text-zinc-800">Show this at the counter</p>
              <p className="text-xs text-zinc-500">Code refreshes every minute · Single use</p>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Animated Badges */}
      <div className="animate-soft-float absolute -left-6 top-1/4 hidden rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-zinc-200/70 sm:block">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Staff Scanned</p>
        <p className="text-sm font-bold text-emerald-600 flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" /> +1 stamp added ☕
        </p>
      </div>

      <div className="animate-soft-float-delayed absolute -right-6 bottom-12 hidden rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-zinc-200/70 sm:block">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">3 More Visits</p>
        <p className="text-sm font-bold text-zinc-900">🎁 Free chai unlocked soon</p>
      </div>
    </div>
  );
}

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
    <li className="relative flex flex-col justify-between rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xs transition-all hover:shadow-md hover:border-brand-200">
      <div>
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-500 text-sm font-bold text-white shadow-sm">
          {n}
        </span>
        <h3 className="mt-4 font-bold text-zinc-900">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{text}</p>
      </div>
      {children}
    </li>
  );
}

function HowItWorks() {
  const [tab, setTab] = useState<"shop" | "customer">("shop");
  const shop = [
    { title: "Create your account", text: "Add your shop name, category & Google listing. Takes about 2 minutes." },
    { title: "Design your stamp card", text: "Pick a ready template like 'Buy 9, get the 10th free' or customize your stamps." },
    { title: "Print your QR standee", text: "Download your free counter poster and stick it near the billing counter." },
    { title: "Scan & reward", text: "On each visit, tap 'Scan' on your phone. Customers get stamps, rewards unlock automatically." },
  ];
  const customer = [
    { title: "Scan counter QR", text: "Opens in the phone browser instantly. No app to download or password to remember." },
    { title: "Join with mobile number", text: "Just name and mobile number. Card is saved on the phone and Google Wallet." },
    { title: "Show card on each visit", text: "Staff scans your card QR code and stamps are credited in real time." },
    { title: "Enjoy your reward", text: "When stamps are full, redeem your free item or discount with one tap." },
  ];
  const steps = tab === "shop" ? shop : customer;

  return (
    <section id="how" className="scroll-mt-20 px-4 py-20 sm:px-6">
      <ScrollReveal direction="up">
        <SectionHeading eyebrow="How it works" title="Simple for you. Even simpler for your customers." />
      </ScrollReveal>

      <ScrollReveal direction="up" delay={100}>
        <div className="mx-auto mt-8 flex w-fit rounded-full bg-zinc-100 p-1 ring-1 ring-zinc-200/50" role="tablist">
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
              className={cx(
                "rounded-full px-5 py-2 text-sm font-semibold transition-all",
                tab === key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </ScrollReveal>

      <ol className="mx-auto mt-10 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <ScrollReveal key={s.title} direction="up" delay={i * 100}>
            <Step n={i + 1} title={s.title} text={s.text} />
          </ScrollReveal>
        ))}
      </ol>
      <ScrollReveal direction="fade" delay={300}>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm font-medium text-zinc-500">
          Have an NFC tag? Customers can also tap it with their phone — your counter staff approves with 1 tap.
        </p>
      </ScrollReveal>
    </section>
  );
}

const FEATURES = [
  { icon: "🎟️", title: "Digital stamp cards", text: "Your logo, your offer. Multiple reward levels, expiry dates and terms — no paper cards to lose." },
  { icon: "📱", title: "QR & NFC collection", text: "Customers show a secure, auto-refreshing QR. Each code works once, so stamps can't be faked or copied." },
  { icon: "⭐", title: "AI review helper", text: "Customers answer 3 quick tags; AI generates authentic Google review drafts in English, Hindi, Gujarati & Hinglish." },
  { icon: "👥", title: "Customer CRM & Segments", text: "See who's regular, who's loyal and who stopped coming. Search, filter and export anytime." },
  { icon: "💬", title: "Free WhatsApp Marketing", text: "Send birthday greetings, 'we miss you' offers and reward alerts via direct wa.me drafts or Cloud API." },
  { icon: "📊", title: "Real-time analytics", text: "Daily visits, returning customers, rewards redeemed and footfall patterns at a glance." },
];

function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-zinc-50/70 px-4 py-20 sm:px-6">
      <ScrollReveal direction="up">
        <SectionHeading
          eyebrow="Features"
          title="Everything to bring customers back"
          subtitle="One simple dashboard for your counter, your team and your customer retention."
        />
      </ScrollReveal>

      <div className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <ScrollReveal key={f.title} direction="up" delay={(i % 3) * 100}>
            <div className="h-full rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xs transition-all hover:shadow-md hover:border-brand-200">
              <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-2xl" aria-hidden>
                {f.icon}
              </span>
              <h3 className="mt-4 font-bold text-zinc-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{f.text}</p>
            </div>
          </ScrollReveal>
        ))}
      </div>

      <ScrollReveal direction="up" delay={200}>
        <div className="mx-auto mt-8 grid max-w-6xl gap-4 sm:grid-cols-3">
          {[
            ["🧑‍🍳", "Staff scanner accounts", "Give counter staff only the scan/issue access they need."],
            ["🏬", "Multiple branch support", "Manage multiple outlets under one master account."],
            ["🔒", "DPDP data protection", "Customers control their marketing consent and can delete anytime."],
          ].map(([icon, title, text]) => (
            <div key={title} className="flex items-start gap-3 rounded-2xl bg-white p-4.5 border border-zinc-200/60 shadow-xs">
              <span className="text-xl" aria-hidden>{icon}</span>
              <div>
                <p className="font-semibold text-zinc-900">{title}</p>
                <p className="text-sm text-zinc-600">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollReveal>
    </section>
  );
}

function ReviewDemo() {
  return (
    <section id="reviews" className="scroll-mt-20 px-4 py-20 sm:px-6">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
        <ScrollReveal direction="right" delay={100}>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 ring-1 ring-amber-200/60">
            ⭐ Boost Your Local Google Ranking
          </div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl text-zinc-900">
            Happy customers want to review you. We make it 1-click easy.
          </h2>
          <p className="mt-4 text-lg text-zinc-600 leading-relaxed">
            Most customers don't post Google reviews because typing is tedious. Our AI helper asks a few simple chips and drafts genuine reviews in their preferred language. They copy and post in 5 seconds.
          </p>
          <ul className="mt-6 space-y-3 text-sm font-medium text-zinc-700">
            {[
              "Multilingual drafts in English, हिन्दी, ગુજરાતી and Hinglish",
              "Uses customer's honest sentiment — never fake or robotic",
              "Google Maps compliant: 100% policy-safe, never gating or incentivized",
              "Direct redirect to your Google Business Profile review dialog",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Check className="mt-0.5 text-emerald-500" /> <span>{t}</span>
              </li>
            ))}
          </ul>
        </ScrollReveal>

        <ScrollReveal direction="left" delay={150}>
          <div className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-zinc-50 p-6 shadow-xl ring-1 ring-zinc-100">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-600">AI Review Generator Preview</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">★★★★★ 5.0</span>
            </div>

            <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-xs">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Customer Selected Tags</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">😃 Great experience</span>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">Masala Chai</span>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">Quick Service</span>
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">Cozy Ambience</span>
              </div>
            </div>

            <div className="my-3 flex justify-center text-zinc-300 font-bold" aria-hidden>
              ↓
            </div>

            <div className="space-y-2.5">
              {[
                { lang: "Hinglish", draft: "Masala Chai aur service dono ekdum superb thi! Ambience kaafi cozy hai aur staff friendly hai. Highly recommended!" },
                { lang: "English", draft: "Had an amazing masala chai here! The service was super quick and the cafe ambience is very cozy. Will visit again!" },
                { lang: "ગુજરાતી", draft: "અહીંની મસાલા ચા અને સર્વિસ ખરેખર ખૂબ જ સરસ છે! વાતાવરણ એકદમ શાંત અને સ્ટાફ વિનમ્ર છે." },
              ].map((item) => (
                <div key={item.lang} className="rounded-2xl border border-zinc-200/70 bg-white p-3.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700">{item.lang}</span>
                    <span className="text-[11px] font-semibold text-brand-600">Copy & Post →</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-700">{item.draft}</p>
                </div>
              ))}
            </div>

            <p className="mt-4 text-center text-xs text-zinc-500">Customer copies the draft with 1 tap and pastes it directly on your Google listing.</p>
          </div>
        </ScrollReveal>
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
      <ScrollReveal direction="up">
        <SectionHeading
          eyebrow="Pricing"
          title="Start free. Upgrade as you grow."
          subtitle="Transparent pricing in ₹ per month. No hidden charges, cancel anytime."
        />
      </ScrollReveal>

      {isLoading ? (
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-96 animate-pulse rounded-2xl bg-white ring-1 ring-zinc-200/60" />
          ))}
        </div>
      ) : error || !data ? (
        <p className="mt-10 text-center text-zinc-500">Pricing couldn't load right now. Please refresh.</p>
      ) : (
        <div className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {data.plans.map((p, i) => {
            const popular = p.code === "starter";
            const l = p.limits;
            const items = [
              limitText(l.customersPerBusiness, "customers"),
              `${limitText(l.programsPerBusiness, "loyalty programs")}`,
              `${limitText(l.staffPerBusiness, "team members")}`,
              l.businesses && l.businesses > 1
                ? `${l.businesses} businesses`
                : l.locationsPerBusiness && l.locationsPerBusiness > 1
                ? `${l.locationsPerBusiness} outlets`
                : "1 outlet",
              `${limitText(l.aiGenerationsPerMonth, "AI review drafts / mo")}`,
              l.marketing ? `${limitText(l.campaignMessagesPerMonth, "WhatsApp messages / mo")}` : null,
              l.nfc ? "NFC tap-to-collect" : null,
              l.advancedAnalytics ? "Advanced analytics" : "Basic analytics",
            ].filter(Boolean) as string[];

            return (
              <ScrollReveal key={p.code} direction="up" delay={i * 100}>
                <div
                  className={cx(
                    "relative flex h-full flex-col rounded-3xl bg-white p-7 shadow-sm transition-all hover:shadow-md",
                    popular ? "ring-2 ring-brand-500 shadow-brand-500/10" : "ring-1 ring-zinc-200/80",
                  )}
                >
                  {popular && (
                    <span className="absolute -top-3.5 left-7 rounded-full bg-brand-500 px-3.5 py-1 text-xs font-bold text-white shadow-sm">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-lg font-bold text-zinc-900">{p.name}</h3>
                  {p.description && <p className="mt-1 text-xs text-zinc-500 min-h-8">{p.description}</p>}
                  <p className="mt-5">
                    <span className="text-3xl font-extrabold tracking-tight text-zinc-900">
                      {p.pricePaise === 0 ? "₹0" : formatINR(p.pricePaise)}
                    </span>
                    <span className="text-xs font-medium text-zinc-500"> / month</span>
                  </p>
                  <ul className="mt-6 flex-1 space-y-2.5 text-xs leading-relaxed text-zinc-700">
                    {items.map((t) => (
                      <li key={t} className="flex items-start gap-2">
                        <Check className="mt-0.5" /> <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/signup" className="mt-7">
                    <Button variant={popular ? "primary" : "secondary"} className="w-full">
                      {p.pricePaise === 0 ? "Start free" : `Start with ${p.name}`}
                    </Button>
                  </Link>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      )}
      <ScrollReveal direction="fade" delay={200}>
        <p className="mt-8 text-center text-xs text-zinc-500">
          Everyone starts on the Free plan. Upgrade from your dashboard whenever you need more customers or outlets.
        </p>
      </ScrollReveal>
    </section>
  );
}

const FAQS: [string, string][] = [
  ["Do my customers need to download an app?", "No. Everything opens instantly in the phone browser — Android or iPhone. Customers join with just their name and mobile number."],
  ["How do I add a stamp at the counter?", "Open 'Scan & Issue' on your phone and scan the QR on the customer's card. Or look up the customer by mobile number if they forgot their phone."],
  ["Can a customer cheat by screenshotting their QR code?", "No. The card's QR token changes every minute and each code works only once. Concurrency locks prevent duplicate stamps."],
  ["What is NFC and do I need it?", "NFC is a contactless sticker customers can tap with their phone instead of scanning. It's optional — QR works for everyone. When someone taps, your staff approves the stamp."],
  ["Is the review helper allowed by Google?", "Yes, 100% compliant: it is offered to every customer equally, never tied to discounts or incentives, never auto-posts, and uses the customer's authentic sentiment."],
  ["How do WhatsApp messages work?", "You can use free direct wa.me click-to-chat drafts right from your phone, or connect WhatsApp Business Cloud API for automated scheduled campaigns."],
  ["Is my customer data safe and private?", "Each business is isolated in its own tenant. Customers control their marketing consent and can request data deletion at any time."],
  ["Can I try it before paying?", "Yes — the Free plan has no time limit and requires no credit card. Upgrade only when you grow."],
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 px-4 py-20 sm:px-6">
      <ScrollReveal direction="up">
        <SectionHeading eyebrow="FAQ" title="Frequently Asked Questions" subtitle="Everything you need to know to get started." />
      </ScrollReveal>

      <ScrollReveal direction="up" delay={150}>
        <div className="mx-auto mt-10 max-w-3xl divide-y divide-zinc-200/80 rounded-3xl border border-zinc-200/80 bg-white shadow-xs">
          {FAQS.map(([q, a]) => (
            <details key={q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-zinc-900">
                {q}
                <span className="text-zinc-400 text-lg transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600">{a}</p>
            </details>
          ))}
        </div>
      </ScrollReveal>
    </section>
  );
}
