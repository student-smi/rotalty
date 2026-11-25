import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "./ui";
import { LoyaltyCard } from "./LoyaltyCard";

/**
 * 3D pieces for the landing page, built with CSS 3D transforms only (no 3D library, almost no extra
 * download). "Lite mode" shows calm static versions for reduced-motion users and weak/data-saver phones.
 */

// ---------- helpers ----------

export function useLiteMode() {
  const [lite, setLite] = useState(true);
  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const weak = (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) || (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2);
    setLite(reduced || weak || !!nav.connection?.saveData);
  }, []);
  return lite;
}

/** True while the element is on screen (animations pause off-screen to save battery). */
function useInView<T extends Element>(rootMargin = "100px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, inView] as const;
}

/** 0 → 1 as a tall section scrolls through the viewport. */
function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      setP(total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return [ref, p] as const;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Local 0→1 progress of a scene between `a` and `b` of the overall progress. */
const seg = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** Card that tilts toward the mouse in 3D, with a soft light sheen. Off on touch screens and in lite mode. */
export function Tilt3D({ children, className, max = 7, lift = 0 }: { children: ReactNode; className?: string; max?: number; lift?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, active: false });
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(window.matchMedia("(hover: hover) and (pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return (
    <div
      ref={ref}
      className={cx("h-full [perspective:900px]", className)}
      onPointerMove={(e) => {
        if (!enabled || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        setT({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5, active: true });
      }}
      onPointerLeave={() => setT({ x: 0, y: 0, active: false })}
    >
      <div
        className="relative h-full transition-transform duration-200 ease-out [transform-style:preserve-3d]"
        style={{ transform: `translateY(${-lift}px) rotateX(${-t.y * max}deg) rotateY(${t.x * max}deg)${t.active ? " translateZ(8px)" : ""}` }}
      >
        {children}
        {enabled && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
            style={{
              opacity: t.active ? 1 : 0,
              background: `radial-gradient(circle at ${(t.x + 0.5) * 100}% ${(t.y + 0.5) * 100}%, rgba(255,255,255,0.35), transparent 55%)`,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------- shared 3D objects ----------

function DemoQrGrid({ size = "size-24" }: { size?: string }) {
  const cells = Array.from({ length: 121 }, (_, i) => ((i * 7919) % 13) % 3 !== 0);
  return (
    <div className={cx("grid grid-cols-11 gap-px rounded-md bg-white p-1", size)} aria-hidden>
      {cells.map((on, i) => {
        const r = Math.floor(i / 11);
        const c = i % 11;
        const finder = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
        return <span key={i} className={finder || on ? "rounded-[1px] bg-zinc-900" : ""} />;
      })}
    </div>
  );
}

/** Acrylic counter standee: a tilted QR board on a base, with depth and a shadow. */
function QrStandee({ className, style, glow }: { className?: string; style?: CSSProperties; glow?: boolean }) {
  return (
    <div className={cx("relative [transform-style:preserve-3d]", className)} style={style} aria-hidden>
      <div className="absolute -bottom-4 left-1/2 h-5 w-40 -translate-x-1/2 rounded-[50%] bg-zinc-900/25 blur-md" />
      <div className="relative mx-auto w-36 [transform-style:preserve-3d]" style={{ transform: "rotateX(-8deg)" }}>
        <div className={cx("rounded-2xl border border-white/70 bg-gradient-to-b from-white to-zinc-100 p-3 shadow-2xl", glow && "ring-4 ring-emerald-400/60")}>
          <p className="text-center text-[10px] font-bold uppercase tracking-wider text-brand-600">Scan to join</p>
          <div className="mt-1.5 flex justify-center">
            <DemoQrGrid />
          </div>
          <p className="mt-1.5 text-center text-[9px] font-semibold text-zinc-500">Chai Point · Loyalty card</p>
        </div>
        <div className="mx-auto h-3 w-28 rounded-b-lg bg-gradient-to-b from-zinc-300 to-zinc-400" style={{ transform: "rotateX(70deg)", transformOrigin: "top" }} />
      </div>
      <div className="mx-auto -mt-1 h-3 w-40 rounded-full bg-gradient-to-b from-zinc-200 to-zinc-400 shadow-md" />
    </div>
  );
}

/** Phone body with visible thickness; children are the screen. */
function Phone3D({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx("relative [transform-style:preserve-3d]", className)} style={style}>
      <div className="absolute inset-0 translate-x-[6px] translate-y-[6px] rounded-[2.4rem] bg-zinc-700" style={{ transform: "translateZ(-10px)" }} aria-hidden />
      <div className="relative rounded-[2.4rem] border border-zinc-700 bg-zinc-900 p-2.5 shadow-[0_40px_80px_-20px_rgba(65,65,168,0.45)]">
        <div className="relative overflow-hidden rounded-[1.9rem] bg-zinc-50">
          <div className="flex items-center justify-between px-5 pb-1.5 pt-3 text-[10px] font-semibold text-zinc-500">
            <span>9:41</span>
            <span className="h-4 w-16 rounded-full bg-zinc-900" />
            <span>5G</span>
          </div>
          {children}
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-white/25" aria-hidden />
        </div>
      </div>
    </div>
  );
}

// ---------- Phase 1: 3D hero ----------

/** Floating 3D phone with a live stamp card (stamps drop in on a loop), a QR standee, and mouse tilt. */
export function Hero3D({ children }: { children?: ReactNode }) {
  const lite = useLiteMode();
  const [wrap, inView] = useInView<HTMLDivElement>();
  const [stamps, setStamps] = useState(7);
  const [dropKey, setDropKey] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  // A stamp lands every 1.8 s; at 10 the reward shows, then the card starts again.
  useEffect(() => {
    if (lite || !inView) return;
    const id = setInterval(() => {
      setStamps((s) => (s >= 10 ? 6 : s + 1));
      setDropKey((k) => k + 1);
    }, 1800);
    return () => clearInterval(id);
  }, [lite, inView]);

  const full = stamps >= 10;
  return (
    <div
      ref={wrap}
      className="relative mx-auto w-full max-w-md [perspective:1400px]"
      onPointerMove={(e) => {
        if (lite || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        setTilt({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      {/* soft drifting colour blobs */}
      <div aria-hidden className="pointer-events-none absolute -inset-10 -z-10">
        <div className={cx("absolute left-0 top-6 size-56 rounded-full bg-brand-300/40 blur-3xl", !lite && "animate-blob")} />
        <div className={cx("absolute bottom-0 right-0 size-64 rounded-full bg-indigo-300/40 blur-3xl", !lite && "animate-blob-delayed")} />
        <div className={cx("absolute right-10 top-0 size-40 rounded-full bg-amber-200/50 blur-3xl", !lite && "animate-blob")} />
      </div>

      <div
        className="relative [transform-style:preserve-3d] transition-transform duration-300 ease-out"
        style={{ transform: lite ? undefined : `rotateX(${8 - tilt.y * 10}deg) rotateY(${-16 + tilt.x * 18}deg)` }}
      >
        <div className={cx("[transform-style:preserve-3d]", !lite && "animate-hero-float")}>
          <Phone3D className="mx-auto w-[18.5rem]">
            <div className="relative space-y-3 px-3.5 pb-5">
              <div className="relative">
                <LoyaltyCard
                  businessName="Chai Point (demo)"
                  programName="Chai lover card"
                  customerName="Riya"
                  stampIcon="coffee"
                  stampsRequired={10}
                  points={stamps}
                  rewards={[{ name: "Free masala chai", pointsRequired: 10 }]}
                />
                {!lite && dropKey > 0 && (
                  <span key={dropKey} className="animate-stamp-drop pointer-events-none absolute left-1/2 top-1/2 text-4xl" aria-hidden>
                    ☕
                  </span>
                )}
              </div>
              <div className={cx("rounded-2xl p-3 text-center shadow-xs ring-1 transition-colors duration-500", full ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-zinc-100")}>
                {full ? (
                  <p className="py-6 text-sm font-bold text-emerald-700">🎉 Free masala chai unlocked!</p>
                ) : (
                  <>
                    <div className="flex justify-center">
                      <DemoQrGrid size="size-24" />
                    </div>
                    <p className="mt-1.5 text-xs font-semibold text-zinc-800">Show this at the counter</p>
                  </>
                )}
              </div>
            </div>
          </Phone3D>
        </div>

        <QrStandee className="absolute -left-4 bottom-2 hidden w-40 sm:block" style={{ transform: "translateZ(60px) rotateY(18deg)" }} />
      </div>
      {children}
    </div>
  );
}

// ---------- Phase 2: scroll story ----------

const STORY = [
  { icon: "🏪", title: "Your counter", text: "Place the free QR standee next to billing." },
  { icon: "📱", title: "Customer scans", text: "Phone camera opens the card. No app, no password." },
  { icon: "☕", title: "Stamps add up", text: "Staff scan the card on every visit. One tap, one stamp." },
  { icon: "🎉", title: "Reward unlocked", text: "Card full? The reward is ready to claim at the counter." },
  { icon: "⭐", title: "Honest Google review", text: "Customers pick a few words; AI helps them write it." },
  { icon: "💬", title: "They come back", text: "A friendly WhatsApp nudge brings regulars back." },
];

/** "How Repeatly works" as a 3D scene that plays while the visitor scrolls. */
export function ScrollStory3D() {
  const lite = useLiteMode();
  const [ref, p] = useScrollProgress<HTMLElement>();
  const scene = Math.min(STORY.length - 1, Math.floor(p * STORY.length));

  if (lite) {
    return (
      <section className="bg-gradient-to-b from-white to-brand-50/40 px-4 py-20 sm:px-6" aria-label="See it in action">
        <StoryHeading />
        <ol className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STORY.map((s, i) => (
            <li key={s.title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
              <span className="text-3xl" aria-hidden>
                {s.icon}
              </span>
              <p className="mt-2 font-bold">
                {i + 1}. {s.title}
              </p>
              <p className="mt-1 text-sm text-zinc-600">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  // Scene timings (overall progress 0..1).
  const scan = ease(seg(p, 0.12, 0.3)); // phone slides to the standee
  const stampsT = seg(p, 0.33, 0.5); // stamps fill
  const flip = ease(seg(p, 0.5, 0.62)); // card flips to reward
  const stars = ease(seg(p, 0.66, 0.8));
  const wa = ease(seg(p, 0.83, 0.95));
  const stampCount = Math.round(3 + stampsT * 7);
  const toCentre = ease(seg(p, 0.3, 0.38));
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const phoneX = p < 0.3 ? lerp(10, -70, scan) : lerp(-70, -50, toCentre);
  const phoneTurn = p < 0.3 ? lerp(-25, -10, scan) : lerp(-10, 0, toCentre);

  return (
    <section ref={ref} className="relative h-[520vh] bg-gradient-to-b from-white via-brand-50/50 to-white" aria-label="See it in action">
      <div className="sticky top-0 flex h-dvh flex-col overflow-hidden px-4 pt-20 sm:px-6">
        <StoryHeading />
        <div className="mx-auto mt-4 grid w-full max-w-6xl flex-1 items-center gap-6 pb-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          {/* captions */}
          <ol className="order-2 space-y-2 md:order-1">
            {STORY.map((s, i) => (
              <li
                key={s.title}
                className={cx(
                  "flex items-start gap-3 rounded-2xl p-3 transition-all duration-500",
                  i === scene ? "bg-white shadow-md ring-1 ring-brand-100" : "opacity-40",
                  i !== scene && "hidden md:flex",
                )}
              >
                <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-xl text-xl transition-colors", i <= scene ? "bg-brand-500" : "bg-zinc-100")} aria-hidden>
                  {s.icon}
                </span>
                <span>
                  <span className="block font-bold text-zinc-900">
                    {i + 1}. {s.title}
                  </span>
                  <span className="block text-sm text-zinc-600">{s.text}</span>
                </span>
              </li>
            ))}
            <li className="pt-2 md:pl-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${p * 100}%` }} />
              </div>
            </li>
          </ol>

          {/* 3D stage */}
          <div className="relative order-1 mx-auto h-[46vh] w-full max-w-lg [perspective:1300px] md:order-2 md:h-[60vh]" aria-hidden>
            <div className="absolute inset-0 [transform-style:preserve-3d]" style={{ transform: `rotateX(10deg) rotateY(${-12 + p * 24}deg)` }}>
              {/* counter top */}
              <div className="absolute bottom-[8%] left-1/2 h-28 w-[90%] -translate-x-1/2 rounded-3xl bg-gradient-to-b from-amber-100 to-amber-200 shadow-inner" style={{ transform: "translateX(-50%) rotateX(72deg)" }} />

              <QrStandee
                glow={scan > 0.9 && p < 0.33}
                className="absolute bottom-[14%] left-[6%] w-40"
                style={{ transform: `translateZ(${-120 + ease(seg(p, 0, 0.1)) * 140}px)` }}
              />

              {/* phone: comes in from the right, goes to the standee to scan, then moves to centre stage */}
              <div
                className="absolute left-1/2 top-[6%] w-52 sm:w-56"
                style={{
                  transform: `translateX(${phoneX}%) translateZ(${60 + scan * 40}px) rotateY(${phoneTurn}deg)`,
                  opacity: seg(p, 0.06, 0.14),
                }}
              >
                <Phone3D>
                  <div className="relative h-72 px-2.5 pb-3 [perspective:800px]">
                    {/* scan beam */}
                    {scan > 0.2 && scan < 1 && <span className="animate-scan-line absolute inset-x-3 top-8 h-0.5 bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.8)]" />}
                    {/* card: front (stamps) / back (reward) */}
                    <div className="relative mt-1 [transform-style:preserve-3d] transition-none" style={{ transform: `rotateY(${flip * 180}deg)` }}>
                      <div className="[backface-visibility:hidden]">
                        <LoyaltyCard
                          compact={false}
                          businessName="Chai Point"
                          programName="Chai lover card"
                          customerName="Riya"
                          stampIcon="coffee"
                          stampsRequired={10}
                          points={p < 0.33 ? 3 : stampCount}
                          rewards={[{ name: "Free chai", pointsRequired: 10 }]}
                        />
                      </div>
                      <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white [backface-visibility:hidden] [transform:rotateY(180deg)]">
                        <span className="text-4xl">🎉</span>
                        <span className="mt-1 text-sm font-extrabold">Free chai unlocked!</span>
                        <span className="text-[11px] text-white/85">Show QR at the counter</span>
                      </div>
                    </div>
                    {/* review stars */}
                    <div className="mt-3 rounded-xl bg-white p-2 text-center shadow-sm ring-1 ring-zinc-100" style={{ opacity: stars, transform: `translateY(${(1 - stars) * 20}px)` }}>
                      <p className="text-lg tracking-wide text-amber-400">
                        {"★★★★★".split("").map((s, i) => (
                          <span key={i} style={{ opacity: clamp01(stars * 5 - i) }}>
                            {s}
                          </span>
                        ))}
                      </p>
                      <p className="text-[10px] text-zinc-600">“Loved the masala chai, quick service!”</p>
                    </div>
                  </div>
                </Phone3D>
              </div>

              {/* WhatsApp bubble */}
              <div
                className="absolute right-[2%] top-[14%] w-52 rounded-2xl rounded-tr-sm bg-[#DCF8C6] p-3 text-xs text-zinc-800 shadow-xl"
                style={{ opacity: wa, transform: `translateZ(${120 * wa}px) translateY(${(1 - wa) * 30}px) scale(${0.8 + wa * 0.2})` }}
              >
                <p className="font-semibold text-emerald-800">Chai Point</p>
                Hi Riya! 😊 We miss you. Your card has 3/10 stamps saved. Drop by soon!
                <p className="mt-1 text-right text-[10px] text-zinc-500">10:30 am ✓✓</p>
              </div>

              {/* confetti when the reward unlocks */}
              {flip > 0.95 && p < 0.7 && (
                <div className="pointer-events-none absolute left-1/2 top-[20%]">
                  {Array.from({ length: 14 }, (_, i) => (
                    <span
                      key={i}
                      className="animate-confetti absolute size-2 rounded-sm"
                      style={{ background: ["#5b5bd6", "#fbbf24", "#34d399", "#f472b6"][i % 4], left: `${(i - 7) * 14}px`, animationDelay: `${(i % 5) * 60}ms` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StoryHeading() {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-bold uppercase tracking-wider text-brand-600">See it in action</p>
      <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-4xl">From first visit to regular customer</h2>
    </div>
  );
}

// ---------- Phase 3: card deck ----------

/** Three cards (web card, Google Wallet pass, review) fan out like a deck when scrolled into view. */
export function CardDeck3D() {
  const lite = useLiteMode();
  const [ref, inView] = useInView<HTMLDivElement>("-20% 0px");
  const open = lite || inView;
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const cards = [
    {
      key: "web",
      rot: -14,
      x: -62,
      body: (
        <LoyaltyCard businessName="Chai Point" programName="Chai lover card" customerName="Riya" stampIcon="coffee" stampsRequired={10} points={6} rewards={[{ name: "Free chai", pointsRequired: 10 }]} compact />
      ),
      label: "Web card · any phone",
    },
    {
      key: "wallet",
      rot: 0,
      x: 0,
      body: (
        <div className="rounded-2xl bg-[#1f1f1f] p-4 text-white shadow-lg">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand-500 text-sm font-bold">C</span>
            <span className="text-sm font-semibold">Chai Point</span>
          </div>
          <p className="mt-4 text-[11px] uppercase tracking-wider text-white/60">Stamps</p>
          <p className="text-2xl font-bold">6 / 10</p>
          <div className="mt-3 flex justify-center rounded-lg bg-white p-1.5">
            <DemoQrGrid size="size-16" />
          </div>
        </div>
      ),
      label: "Google Wallet pass (soon)",
    },
    {
      key: "review",
      rot: 14,
      x: 62,
      body: (
        <div className="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-zinc-200">
          <p className="text-lg tracking-wide text-amber-400">★★★★★</p>
          <p className="mt-2 text-xs leading-relaxed text-zinc-700">“Masala chai was fresh and the staff were quick and friendly. Lovely small place!”</p>
          <p className="mt-3 text-[10px] font-semibold text-zinc-400">Posted on Google by Riya</p>
        </div>
      ),
      label: "Honest Google review",
    },
  ];
  return (
    <section className="overflow-hidden px-4 py-20 sm:px-6" aria-label="One card, everywhere">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-bold uppercase tracking-wider text-brand-600">One card, everywhere</p>
        <h2 className="mt-1 text-3xl font-extrabold tracking-tight text-zinc-900 sm:text-4xl">In the browser, in Google Wallet, and on Google Maps</h2>
      </div>
      <div ref={ref} className="relative mx-auto mt-12 flex h-[22rem] max-w-3xl items-center justify-center [perspective:1400px] sm:h-80">
        {cards.map((c, i) => (
          <div
            key={c.key}
            className="group absolute w-56 transition-all duration-700 ease-out sm:w-64"
            style={{
              transform: open
                ? `translateX(${c.x * (narrow ? 0.55 : 2.2)}%) rotateZ(${c.rot}deg) rotateY(${c.rot * -0.6}deg) translateZ(${i === 1 ? 40 : 0}px)`
                : "translateX(0) rotateZ(0) translateZ(0)",
              zIndex: i === 1 ? 2 : 1,
              transitionDelay: `${i * 90}ms`,
            }}
          >
            <div className="transition-transform duration-300 group-hover:-translate-y-3">{c.body}</div>
            <p className={cx("mt-3 text-center text-xs font-semibold text-zinc-500 transition-opacity duration-500", open ? "opacity-100" : "opacity-0")}>{c.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- "Your counter": interactive demo (replaces the stock photos) ----------

/** The visitor types their shop name, sees their own poster on a 3D standee, and gives stamps by QR or NFC. */
export function CounterDemo({ signupHref }: { signupHref: (shop: string) => string }) {
  const lite = useLiteMode();
  const [shop, setShop] = useState("Sharma Chai Point");
  const [mode, setMode] = useState<"qr" | "nfc">("qr");
  const [stamps, setStamps] = useState(3);
  const [busy, setBusy] = useState(false);
  const [dropKey, setDropKey] = useState(0);
  const name = shop.trim() || "Your shop";
  const full = stamps >= 10;

  function giveStamp() {
    if (busy) return;
    if (full) {
      setStamps(0);
      return;
    }
    setBusy(true);
    // Phone moves to the standee / taps the NFC tag, then the stamp lands.
    setTimeout(
      () => {
        setStamps((s) => Math.min(10, s + 1));
        setDropKey((k) => k + 1);
        setBusy(false);
      },
      lite ? 0 : 900,
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-5">
        <label className="block">
          <span className="text-sm font-semibold text-zinc-800">1. Type your shop name</span>
          <input
            value={shop}
            onChange={(e) => setShop(e.target.value.slice(0, 32))}
            className="mt-1.5 h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base shadow-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            placeholder="e.g. Sharma Chai Point"
          />
        </label>
        <div>
          <span className="text-sm font-semibold text-zinc-800">2. How do customers collect?</span>
          <div className="mt-1.5 flex w-fit rounded-xl bg-zinc-100 p-1" role="radiogroup" aria-label="Collection method">
            {(
              [
                ["qr", "📷 Scan QR"],
                ["nfc", "📶 Tap NFC tag"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cx("rounded-lg px-4 py-2 text-sm font-semibold transition", mode === m ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-sm font-semibold text-zinc-800">3. Try it</span>
          <button
            type="button"
            onClick={giveStamp}
            disabled={busy}
            className={cx(
              "mt-1.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-70",
              full ? "bg-emerald-600 hover:bg-emerald-700" : "bg-brand-500 hover:bg-brand-600",
            )}
          >
            {full ? "↺ Start a new card" : busy ? (mode === "qr" ? "Scanning…" : "Tapping…") : "☕ Give a stamp"}
          </button>
          <p className="mt-1.5 text-xs text-zinc-500" aria-live="polite">
            {full ? "Card full: the reward is ready to claim." : `${stamps} of 10 stamps. ${10 - stamps} more for a free chai.`}
          </p>
        </div>
        <a
          href={signupHref(name)}
          className="flex h-12 items-center justify-center rounded-xl border-2 border-brand-500 text-base font-semibold text-brand-700 transition hover:bg-brand-50"
        >
          {name.length > 18 ? "Get this poster for your shop, free →" : `Get this poster for ${name}, free →`}
        </a>
      </div>

      {/* 3D counter */}
      <div className="relative h-[26rem] [perspective:1300px]" aria-label={`Demo: ${name} counter`} role="img">
        <div className="absolute inset-0 [transform-style:preserve-3d]" style={{ transform: lite ? undefined : "rotateX(12deg) rotateY(-14deg)" }}>
          <div className="absolute bottom-6 left-1/2 h-32 w-[95%] rounded-3xl bg-gradient-to-b from-amber-100 to-amber-300 shadow-inner" style={{ transform: "translateX(-50%) rotateX(74deg)" }} />

          {/* poster on standee, with the visitor's own shop name */}
          <div className="absolute bottom-16 left-[6%] w-44 [transform-style:preserve-3d]" style={{ transform: "translateZ(30px) rotateY(12deg)" }}>
            <div className="absolute -bottom-4 left-1/2 h-4 w-44 -translate-x-1/2 rounded-[50%] bg-zinc-900/25 blur-md" />
            <div
              className={cx(
                "overflow-hidden rounded-2xl border border-white/80 bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-400 p-3 text-center text-white shadow-2xl transition-shadow",
                busy && mode === "qr" && "ring-4 ring-emerald-400/70",
              )}
            >
              <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-white text-sm font-bold text-brand-600">{name[0]?.toUpperCase()}</span>
              <p className="mt-1 truncate text-[11px] font-bold">{name}</p>
              <p className="mt-1 text-[13px] font-extrabold leading-tight">Collect stamps, get free chai!</p>
              <div className="mx-auto mt-2 w-fit rounded-lg bg-white p-1">
                <DemoQrGrid size="size-20" />
              </div>
              <p className="mt-1.5 text-[9px] text-white/85">Scan with your phone camera</p>
            </div>
            <div className="mx-auto -mt-0.5 h-3 w-44 rounded-full bg-gradient-to-b from-zinc-200 to-zinc-400" />
          </div>

          {/* NFC tag on the counter */}
          <div
            className={cx(
              "absolute bottom-14 right-[30%] flex size-14 items-center justify-center rounded-full bg-zinc-800 text-xl text-white shadow-lg transition-opacity",
              mode === "nfc" ? "opacity-100" : "opacity-0",
            )}
            style={{ transform: "translateZ(40px) rotateX(55deg)" }}
          >
            📶
            {busy && mode === "nfc" && !lite && <span className="absolute inset-0 animate-ping rounded-full bg-brand-400/50" />}
          </div>

          {/* customer phone */}
          <div
            className="absolute right-[2%] top-2 w-48 transition-transform duration-700 ease-out"
            style={{
              transform:
                busy && !lite
                  ? mode === "qr"
                    ? "translateX(-70%) translateZ(90px) rotateY(-20deg)"
                    : "translateX(-28%) translateY(18%) translateZ(70px) rotateX(35deg)"
                  : "translateZ(60px) rotateY(-8deg)",
            }}
          >
            <Phone3D>
              <div className="relative px-2.5 pb-3">
                {busy && mode === "qr" && !lite && <span className="animate-scan-line absolute inset-x-3 top-6 z-10 h-0.5 bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.8)]" />}
                <div className="relative">
                  <LoyaltyCard
                    businessName={name}
                    programName="Loyalty card"
                    customerName="Riya"
                    stampIcon="coffee"
                    stampsRequired={10}
                    points={stamps}
                    rewards={[{ name: "Free chai", pointsRequired: 10 }]}
                  />
                  {!lite && dropKey > 0 && (
                    <span key={dropKey} className="animate-stamp-drop pointer-events-none absolute left-1/2 top-1/2 text-3xl" aria-hidden>
                      ☕
                    </span>
                  )}
                </div>
                <p className={cx("mt-2 rounded-lg py-2 text-center text-[11px] font-semibold", full ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600")}>
                  {full ? "🎉 Free chai unlocked!" : mode === "nfc" ? "Code for staff: 4 8 2 7" : "+1 stamp each visit"}
                </p>
              </div>
            </Phone3D>
          </div>

          {full && !lite && (
            <div className="pointer-events-none absolute right-[25%] top-[10%]">
              {Array.from({ length: 14 }, (_, i) => (
                <span
                  key={`${dropKey}-${i}`}
                  className="animate-confetti absolute size-2 rounded-sm"
                  style={{ background: ["#5b5bd6", "#fbbf24", "#34d399", "#f472b6"][i % 4], left: `${(i - 7) * 12}px`, animationDelay: `${(i % 5) * 60}ms` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Earnings calculator ----------

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function CalcSlider({ label, value, set, min, max, step, show }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; show: string }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-zinc-700">{label}</span>
        <span className="text-lg font-bold tabular-nums text-zinc-900">{show}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="mt-2 w-full cursor-pointer accent-brand-500" />
    </label>
  );
}

/** "What could repeat visits earn me?" Simple, transparent maths, clearly labelled as an estimate. */
export function EarningsCalculator({ planPricePaise }: { planPricePaise?: number | null }) {
  const [perDay, setPerDay] = useState(40);
  const [bill, setBill] = useState(150);
  const [pct, setPct] = useState(10);
  const extraVisits = Math.round((perDay * 30 * pct) / 100);
  const extra = extraVisits * bill;
  const times = planPricePaise ? extra / (planPricePaise / 100) : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 rounded-3xl bg-white p-6 shadow-xl ring-1 ring-zinc-100 sm:p-8 md:grid-cols-2">
      <div className="space-y-6">
        <CalcSlider label="Customers per day" value={perDay} set={setPerDay} min={10} max={300} step={5} show={String(perDay)} />
        <CalcSlider label="Average bill" value={bill} set={setBill} min={50} max={2000} step={10} show={inr(bill)} />
        <CalcSlider label="Customers who come back one extra time a month" value={pct} set={setPct} min={5} max={30} step={1} show={`${pct}%`} />
      </div>
      <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-500 p-6 text-white" aria-live="polite">
        <p className="text-sm text-white/80">Extra sales per month (estimate)</p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums sm:text-5xl">{inr(extra)}</p>
        <p className="mt-3 text-sm text-white/85">
          {extraVisits.toLocaleString("en-IN")} extra visits × {inr(bill)} average bill
        </p>
        {times !== null && times >= 2 && (
          <p className="mt-4 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium">That's about {Math.floor(times)}× the price of the Starter plan.</p>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-white/70">
          Simple estimate: {perDay} customers × 30 days × {pct}% coming back once more. Real results depend on your shop and your offer.
        </p>
      </div>
    </div>
  );
}

// ---------- Sticky mobile call-to-action ----------

/** A "Start free" bar pinned to the bottom of phones once the visitor scrolls past the hero. */
export function StickyMobileCta({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      const nearEnd = window.innerHeight + window.scrollY > document.body.scrollHeight - 700;
      setShow(window.scrollY > 650 && !nearEnd);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      className={cx(
        "fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-transform duration-300 md:hidden",
        show ? "translate-y-0" : "translate-y-full",
      )}
      aria-hidden={!show}
    >
      <a href={href} tabIndex={show ? 0 : -1} className="flex h-12 items-center justify-center rounded-xl bg-brand-500 text-base font-semibold text-white shadow-lg">
        {label}
      </a>
    </div>
  );
}
