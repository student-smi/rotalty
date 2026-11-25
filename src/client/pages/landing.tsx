import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { authClient } from "../lib/auth";
import { BRAND, Logo } from "../lib/brand";
import { formatINR } from "../lib/billing-format";
import { Button, cx } from "../components/ui";
import { ScrollReveal, ScrollProgressBar } from "../components/ScrollReveal";
import { ShopContactRow } from "../components/ShopPage";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { CardDeck3D, CounterDemo, EarningsCalculator, Hero3D, ScrollStory3D, StickyMobileCta, Tilt3D } from "../components/landing3d";
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
  { href: "#whatsapp", label: "WhatsApp" },
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
              {["Set up in 5 minutes", "Works on every phone", "Your Instagram & WhatsApp on the card"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check /> {t}
                </li>
              ))}
            </ul>
          </ScrollReveal>

          <ScrollReveal direction="scale" delay={150} distance={20}>
            <Hero3D>
              <HeroBadges />
            </Hero3D>
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

      <ScrollStory3D />

      <HowItWorks />

      {/* Visual Showcase: Physical Counter & Smart Tap */}
      <section className="border-t border-zinc-100 bg-gradient-to-b from-white via-zinc-50/60 to-white px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <ScrollReveal direction="up">
            <SectionHeading
              eyebrow="Real-World Counter Setup"
              title="Looks beautiful on your counter. Takes zero training."
              subtitle="Type your shop name, pick QR or NFC, and give a stamp. This is exactly what your customers will see."
            />
          </ScrollReveal>

          <ScrollReveal direction="up" delay={100}>
            <div className="mt-12">
              <CounterDemo
                signupHref={(shop) => {
                  return signedIn ? "/app" : `/signup?shop=${encodeURIComponent(shop)}`;
                }}
              />
            </div>
          </ScrollReveal>
        </div>
      </section>

      <Features />
      <CardDeck3D />
      <SocialOnCard />
      <CustomerPerks />
      <ReviewDemo />
      <WhatsAppDemo />
      <LandingEarnings />
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
            <p className="mt-4 text-xs text-white/70">No credit card required · Free plan available · 5-minute setup</p>
          </div>
        </ScrollReveal>
      </section>

      <StickyMobileCta href={signedIn ? "/app" : "/signup"} label={signedIn ? "Go to my dashboard" : "Start free — 5-minute setup"} />

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

/** Floating "stamp added" / "reward soon" badges around the 3D hero phone. */
function HeroBadges() {
  return (
    <>
      <div className="animate-soft-float absolute -left-6 top-1/4 z-10 hidden rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-zinc-200/70 sm:block">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Staff Scanned</p>
        <p className="text-sm font-bold text-emerald-600 flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" /> +1 stamp added ☕
        </p>
      </div>

      <div className="animate-soft-float-delayed absolute -right-6 bottom-12 z-10 hidden rounded-2xl bg-white px-4 py-3 shadow-xl ring-1 ring-zinc-200/70 sm:block">
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">3 More Visits</p>
        <p className="text-sm font-bold text-zinc-900">🎁 Free chai unlocked soon</p>
      </div>
    </>
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
    { title: "Join with mobile number", text: "Just name and mobile number. The card is saved on the phone and can be added to the home screen." },
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
            <Tilt3D>
              <Step n={i + 1} title={s.title} text={s.text} />
            </Tilt3D>
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

const FEATURE_GROUPS: { title: string; subtitle: string; items: { icon: string; title: string; text: string; tag?: string }[] }[] = [
  {
    title: "Set up in minutes",
    subtitle: "Ready before your next customer walks in",
    items: [
      { icon: "🔎", title: "Find your shop on Google", text: "Search your shop and your name, address and phone fill in automatically from Google Maps." },
      { icon: "🎟️", title: "Stamp card with live preview", text: "Ready-made cards for cafés, salons, bakeries and more. Change stamps, rewards and rules and see the customer's card update as you type." },
      { icon: "🖨️", title: "Free poster studio", text: "Design your counter poster, table stand or WhatsApp status image. Download it or print on A4, A5 or A6." },
    ],
  },
  {
    title: "At the counter",
    subtitle: "One tap for staff, no app for customers",
    items: [
      { icon: "📷", title: "Secure scan-to-stamp", text: "Customers show a QR that changes every 90 seconds and works only once, so stamps can't be copied or faked." },
      { icon: "📶", title: "NFC tap & phone lookup", text: "Customers can tap an NFC tag, or staff find them by mobile number if they forgot their phone.", tag: "NFC on paid plans" },
      { icon: "🧑‍🍳", title: "Staff & multiple outlets", text: "Give counter staff scan-only access. Run several outlets or shops from one account." },
    ],
  },
  {
    title: "Bring customers back",
    subtitle: "Turn one visit into many",
    items: [
      { icon: "💬", title: "Free WhatsApp reminders", text: "Birthday wishes, 'we miss you' and 'your reward is ready' messages open ready-typed in your WhatsApp. You tap Send. No per-message cost." },
      { icon: "👥", title: "Customer list & groups", text: "See new, regular, loyal and missing customers, and who has a reward waiting. Search any customer in seconds." },
      { icon: "📞", title: "Your WhatsApp & Instagram on every card", text: "Customers can chat with you, follow your Instagram, call you or get directions straight from their card." },
    ],
  },
  {
    title: "Grow on Google",
    subtitle: "More honest reviews, more walk-ins",
    items: [
      { icon: "⭐", title: "AI review helper", text: "Customers pick a few words about their visit; AI writes 3 honest drafts in English, हिन्दी, ગુજરાતી or Hinglish. They post it themselves." },
      { icon: "🧠", title: "Smart keywords for your shop", text: "AI suggests review keywords from your shop details and Google listing. Keep the ones that fit and add your own." },
      { icon: "📊", title: "Analytics that matter", text: "Visits, returning customers, rewards, review activity and how many customers tapped your WhatsApp or Instagram." },
      { icon: "🔒", title: "Private & DPDP-ready", text: "Every shop's data is separate. Customers choose their marketing consent and can delete their data anytime." },
    ],
  },
];

function Features() {
  return (
    <section id="features" className="scroll-mt-20 bg-zinc-50/70 px-4 py-20 sm:px-6">
      <ScrollReveal direction="up">
        <SectionHeading
          eyebrow="Features"
          title="Everything to bring customers back"
          subtitle="One simple app for your counter, your team and your regulars."
        />
      </ScrollReveal>

      <div className="mx-auto mt-12 max-w-6xl space-y-12">
        {FEATURE_GROUPS.map((g) => (
          <div key={g.title}>
            <ScrollReveal direction="up">
              <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-xl font-extrabold tracking-tight text-zinc-900">{g.title}</h3>
                <p className="text-sm text-zinc-500">{g.subtitle}</p>
              </div>
            </ScrollReveal>
            <div className={cx("grid gap-5 sm:grid-cols-2", g.items.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
              {g.items.map((f, i) => (
                <ScrollReveal key={f.title} direction="up" delay={(i % 4) * 90}>
                  <Tilt3D>
                    <div className="h-full rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-xs transition-all hover:border-brand-200 hover:shadow-md">
                      <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-2xl" aria-hidden>
                        {f.icon}
                      </span>
                      <h4 className="mt-4 font-bold text-zinc-900">{f.title}</h4>
                      <p className="mt-1.5 text-sm leading-relaxed text-zinc-600">{f.text}</p>
                      {f.tag && <span className="mt-3 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">{f.tag}</span>}
                    </div>
                  </Tilt3D>
                </ScrollReveal>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const CUSTOMER_PERKS: [string, string, string][] = [
  ["📲", "No app to download", "The card opens in the phone browser. Join with just a name and mobile number."],
  ["🗂️", "All their cards in one place", "Cards from every Repeatly shop sit together under one mobile number."],
  ["🏠", "Add to home screen", "One tap puts the card on their home screen, like an app."],
  ["💳", "Google Wallet (rolling out)", "Android users will be able to save the card to Google Wallet, with stamps updating there too. Rolling out soon."],
  ["🔁", "Never lose a card", "New phone? They enter their mobile number and their cards are back."],
  ["🙋", "Their data, their choice", "They choose WhatsApp consent per shop and can delete their data anytime."],
];

/** Shop owners can put their Instagram and WhatsApp on every customer's loyalty card. */
function SocialOnCard() {
  return (
    <section className="bg-gradient-to-b from-white via-pink-50/40 to-white px-4 py-20 sm:px-6" aria-label="Instagram and WhatsApp on your loyalty card">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
        <ScrollReveal direction="right" delay={100}>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-pink-50 px-3 py-1 text-xs font-bold text-pink-700 ring-1 ring-pink-200">
            📸 Instagram + 💬 WhatsApp
          </div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-zinc-900 sm:text-4xl">Add your Instagram and WhatsApp to your loyalty card</h2>
          <p className="mt-4 text-lg leading-relaxed text-zinc-600">
            Every customer who joins sees your buttons right on their card. One tap to follow you on Instagram, chat with you on WhatsApp, call you, or get directions to
            your shop.
          </p>
          <ul className="mt-6 space-y-3 text-sm font-medium text-zinc-700">
            {[
              "Add them once in Shop settings, with a live preview",
              "Shows on the card, the “My cards” list and your shop page",
              "Paste your Instagram link or just your username",
              "Directions come automatically from your Google listing",
              "See how many customers tapped each button in Analytics",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Check className="mt-0.5 text-pink-500" /> <span>{t}</span>
              </li>
            ))}
          </ul>
        </ScrollReveal>
        <ScrollReveal direction="left" delay={150}>
          <Tilt3D max={6}>
            <div className="mx-auto max-w-sm rounded-[2rem] bg-white p-4 shadow-2xl ring-1 ring-zinc-100">
              <LoyaltyCard
                businessName="Chai Point"
                programName="Chai lover card"
                customerName="Riya"
                stampIcon="coffee"
                stampsRequired={10}
                points={6}
                rewards={[{ name: "Free masala chai", pointsRequired: 10 }]}
                compact
              />
              <ShopContactRow
                name="Chai Point"
                preview
                links={{ whatsapp: "#", instagram: "#", directions: "#", call: "#", website: null }}
              />
            </div>
          </Tilt3D>
        </ScrollReveal>
      </div>
    </section>
  );
}

function CustomerPerks() {
  return (
    <section className="px-4 py-20 sm:px-6" aria-label="What your customers get">
      <ScrollReveal direction="up">
        <SectionHeading eyebrow="For your customers" title="So easy, they'll actually use it" subtitle="What your customers get when they join your card." />
      </ScrollReveal>
      <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CUSTOMER_PERKS.map(([icon, title, text], i) => (
          <ScrollReveal key={title} direction="up" delay={(i % 3) * 90}>
            <div className="flex h-full items-start gap-3 rounded-2xl border border-zinc-200/70 bg-white p-5 shadow-xs">
              <span className="text-2xl" aria-hidden>
                {icon}
              </span>
              <span>
                <span className="block font-bold text-zinc-900">{title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-zinc-600">{text}</span>
              </span>
            </div>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}

/** Showcase of WhatsApp draft messaging: today's list and a ready-typed message. */
function WhatsAppDemo() {
  const today = [
    ["🎂", "Riya Shah", "Birthday today"],
    ["🎁", "Amit Patel", "Free chai ready"],
    ["😊", "Neha Joshi", "Last visit 48 days ago"],
  ];
  return (
    <section id="whatsapp" className="scroll-mt-20 bg-emerald-50/40 px-4 py-20 sm:px-6">
      <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
        <ScrollReveal direction="left" delay={150}>
          <div className="space-y-4">
            <div className="rounded-3xl border border-zinc-200/90 bg-white p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">📋 Today's list</span>
                <span className="text-xs text-zinc-400">3 customers</span>
              </div>
              <ul className="divide-y divide-zinc-100">
                {today.map(([icon, name, why]) => (
                  <li key={name} className="flex items-center gap-3 py-2.5">
                    <span className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-lg" aria-hidden>
                      {icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{name}</span>
                      <span className="block text-xs text-zinc-500">{why}</span>
                    </span>
                    <span className="rounded-lg bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white">Send</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ml-auto max-w-xs rounded-2xl rounded-tl-sm bg-[#DCF8C6] p-3.5 text-sm text-zinc-800 shadow-lg">
              Namaste Riya ji! 🎂 Happy Birthday from all of us at Chai Point. Aaj aaiye, chai humari taraf se!
              <p className="mt-1 text-right text-[10px] text-zinc-500">10:30 am ✓✓</p>
            </div>
          </div>
        </ScrollReveal>
        <ScrollReveal direction="right" delay={100}>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
            💬 Free, from your own WhatsApp
          </div>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-zinc-900 sm:text-4xl">Know who to message today. Send in one tap.</h2>
          <p className="mt-4 text-lg leading-relaxed text-zinc-600">
            Every day Repeatly lists the customers worth a message: birthdays, rewards waiting and regulars who stopped coming. Tap Send and WhatsApp opens with the message
            already typed.
          </p>
          <ul className="mt-6 space-y-3 text-sm font-medium text-zinc-700">
            {[
              "Ready messages in English, हिन्दी, ગુજરાતી and Hinglish",
              "Send an offer to a whole group, one tap per customer",
              "“Thank you” button right after a stamp at the counter",
              "Only customers who agreed to WhatsApp are shown",
              "No per-message charges, no WhatsApp Business API needed",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <Check className="mt-0.5 text-emerald-500" /> <span>{t}</span>
              </li>
            ))}
          </ul>
        </ScrollReveal>
      </div>
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
              "Designed to follow Google's review policies: never gated or rewarded",
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
              "Free WhatsApp reminders",
              "Add-to-home-screen card",
              l.nfc ? "NFC tap-to-collect" : null,
              l.advancedAnalytics ? "Advanced analytics" : "Basic analytics",
            ].filter(Boolean) as string[];

            return (
              <ScrollReveal key={p.code} direction="up" delay={i * 100}>
                <Tilt3D lift={popular ? 10 : 0} max={5}>
                <div
                  className={cx(
                    "relative flex h-full flex-col rounded-3xl bg-white p-7 shadow-sm transition-all hover:shadow-md",
                    popular ? "ring-2 ring-brand-500 shadow-2xl shadow-brand-500/25" : "ring-1 ring-zinc-200/80",
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
                </Tilt3D>
              </ScrollReveal>
            );
          })}
        </div>
      )}
      <ScrollReveal direction="fade" delay={200}>
        <p className="mt-8 text-center text-xs text-zinc-500">
          Everyone starts on the Free plan. Need more? Tap “Request” in your dashboard and our team will help you upgrade.
        </p>
      </ScrollReveal>
    </section>
  );
}

const FAQS: [string, string][] = [
  ["Do my customers need to download an app?", "No. Everything opens instantly in the phone browser — Android or iPhone. Customers join with just their name and mobile number."],
  ["How do I add a stamp at the counter?", "Open 'Scan & Issue' on your phone and scan the QR on the customer's card. Or look up the customer by mobile number if they forgot their phone."],
  ["Can a customer cheat by screenshotting their QR code?", "No. The card's QR code changes every 90 seconds and each code works only once. Concurrency locks prevent duplicate stamps."],
  ["What is NFC and do I need it?", "NFC is a contactless sticker customers can tap with their phone instead of scanning. It's optional — QR works for everyone. When someone taps, your staff approves the stamp."],
  ["Is the review helper allowed by Google?", "It's designed to follow Google's review policies: it is offered to every customer equally, never tied to discounts or incentives, never auto-posts, and uses only what the customer picks."],
  ["How do WhatsApp messages work?", "Repeatly prepares the message (birthday wishes, reward reminders, offers) and opens it in your own WhatsApp; you just tap Send. No per-message charges. Automatic sending is coming later."],
  ["Is my customer data safe and private?", "Each business is isolated in its own tenant. Customers control their marketing consent and can request data deletion at any time."],
  ["Can customers keep the card in Google Wallet?", "Google Wallet support for Android is rolling out soon: customers will tap “Add to Google Wallet” and stamps will update there automatically. Today, every customer (Android or iPhone) can add the card to their home screen in one tap."],
  ["What if a customer changes phone?", "They open “My cards”, enter the mobile number they joined with, and all their cards are back."],
  ["Can my staff use it?", "Yes. Invite staff with their email; they get only the access they need, like scanning and giving stamps. You can run several outlets too."],
  ["Do I need to print anything special?", "No. Download your QR poster from the dashboard (counter poster, table stand or WhatsApp status) and print it on normal paper. An acrylic stand makes it look great."],
  ["Can customers reach me from their card?", "Yes. Add your WhatsApp number, Instagram and website in Shop settings. Buttons to chat, follow, call or get directions appear on every customer's card."],
  ["How do I upgrade my plan?", "Tap “Request” on a plan in your dashboard. Our team will message you on WhatsApp with payment details and switch on your plan."],
  ["Can I try it before paying?", "Yes. Start on the Free plan with no credit card. Upgrade only when you grow."],
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

/** "What could repeat customers earn you?" with the live Starter price for comparison. */
function LandingEarnings() {
  const { data } = useQuery({
    queryKey: ["public-plans"],
    queryFn: () => api<{ plans: PublicPlan[] }>("/api/public/plans"),
    staleTime: 5 * 60_000,
  });
  const starter = data?.plans.find((p) => p.code === "starter");
  return (
    <section className="scroll-mt-20 bg-gradient-to-b from-white to-brand-50/50 px-4 py-20 sm:px-6" aria-label="Earnings calculator">
      <ScrollReveal direction="up">
        <SectionHeading
          eyebrow="Earnings calculator"
          title="What could repeat customers earn you?"
          subtitle="Move the sliders to match your shop."
        />
      </ScrollReveal>
      <ScrollReveal direction="up" delay={100}>
        <div className="mt-10">
          <EarningsCalculator planPricePaise={starter?.pricePaise ?? null} />
        </div>
      </ScrollReveal>
    </section>
  );
}
