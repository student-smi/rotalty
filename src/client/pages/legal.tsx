import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../lib/api";
import { captchaHeaders, TURNSTILE_SITE_KEY } from "../lib/captcha";
import { BRAND, Logo } from "../lib/brand";
import { reviewFetch } from "../lib/review-api";
import { Turnstile } from "../components/Turnstile";
import { Alert, Button, Input, Select, Textarea } from "../components/ui";

const UPDATED = "23 November 2026";

function PublicShell({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · ${BRAND}`;
    window.scrollTo(0, 0);
  }, [title]);
  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b border-zinc-100">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link to="/" aria-label="Home">
            <Logo />
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-600">
            <Link to="/support" className="hover:text-zinc-900">Support</Link>
            <Link to="/login" className="hover:text-zinc-900">Shop login</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-zinc-100">
      <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-zinc-500 sm:flex-row">
        <p>© {new Date().getFullYear()} {BRAND}</p>
        <div className="flex flex-wrap justify-center gap-4">
          <Link to="/support" className="hover:text-zinc-800">Support</Link>
          <Link to="/privacy" className="hover:text-zinc-800">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-zinc-800">Terms of Service</Link>
        </div>
      </div>
    </footer>
  );
}

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="space-y-4 text-[15px] leading-relaxed text-zinc-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-900 [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">Last updated: {UPDATED}</p>
      </header>
      {children}
    </article>
  );
}

// ---------- Support ----------

const OWNER_FAQ = [
  ["How do I set up my shop?", "Sign up, then follow the 4 steps: shop details (search your shop on Google to fill them in), stamp card, Google reviews, and your printable QR poster. It takes about 5 minutes."],
  ["How do I give a customer a stamp?", "Open “Scan & Issue” in your dashboard and scan the QR on the customer's card (web card or Google Wallet). You can also find the customer by mobile number."],
  ["A customer's Google Wallet card is shown for a reward. What do I check?", "The scanner asks you to confirm the last 4 digits of the customer's mobile number before showing rewards, so a copied QR can't be used."],
  ["How do I change or cancel my plan?", "Go to Plan & billing in your dashboard. Plans are paid for 30 days at a time and don't renew automatically."],
];

const CUSTOMER_FAQ = [
  ["Do I need to install an app?", "No. Your card opens in your phone's browser. On Android you can also add it to Google Wallet."],
  ["I changed my phone. How do I get my cards back?", "Open “My cards” and choose “Find my cards”, then enter the mobile number you used to join."],
  ["Who gives the rewards?", "Each shop runs its own loyalty card and rewards. Please speak to the shop about a specific offer."],
  ["How do I delete my data?", "Open My cards → Settings → Delete my data. This removes your name and mobile number and withdraws your marketing consents."],
];

export function SupportPage() {
  return (
    <PublicShell title="Support">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">How can we help?</h1>
      <p className="mt-2 text-zinc-600">Answers to common questions, or send us a message and we'll get back to you.</p>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <FaqBlock title="For shop owners & staff" items={OWNER_FAQ} />
        <FaqBlock title="For customers" items={CUSTOMER_FAQ} />
      </div>

      <section id="contact" className="mt-10 rounded-2xl border border-zinc-200 bg-zinc-50 p-5 sm:p-7">
        <h2 className="text-xl font-semibold text-zinc-900">Contact support</h2>
        <p className="mt-1 text-sm text-zinc-600">We usually reply within 2 working days, by email or on the mobile number you give us.</p>
        <ContactForm />
      </section>
    </PublicShell>
  );
}

function FaqBlock({ title, items }: { title: string; items: string[][] }) {
  return (
    <section>
      <h2 className="mb-3 font-semibold text-zinc-900">{title}</h2>
      <div className="space-y-2">
        {items.map(([q, a]) => (
          <details key={q} className="group rounded-xl border border-zinc-200 bg-white p-4">
            <summary className="cursor-pointer list-none font-medium text-zinc-800 marker:hidden">
              <span className="mr-2 inline-block text-brand-500 transition group-open:rotate-90">›</span>
              {q}
            </summary>
            <p className="mt-2 text-sm text-zinc-600">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function ContactForm() {
  const [captcha, setCaptcha] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setCaptcha(t), []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v).trim()]));
    setLoading(true);
    setErrors({});
    setError(null);
    try {
      await reviewFetch("/api/public/support", { body: f, headers: captchaHeaders(captcha) });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setError(err.status === 429 ? "Too many messages. Please try again in a minute." : Object.keys(err.fieldErrors()).length ? null : err.message);
      } else setError("No internet connection. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="mt-5">
        <Alert tone="success">Thanks! Your message has been sent. We'll get back to you soon.</Alert>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Your name" name="name" required minLength={2} maxLength={80} error={errors.name} />
        <Input label="Email or mobile number" name="contact" required maxLength={120} placeholder="you@example.com or 98765 43210" error={errors.contact} />
        <Select label="I am a…" name="topic" defaultValue="shop_owner" error={errors.topic}>
          <option value="shop_owner">Shop owner / staff</option>
          <option value="customer">Customer</option>
          <option value="privacy">Privacy or data request</option>
          <option value="other">Something else</option>
        </Select>
        <Input label="Shop name (optional)" name="businessName" maxLength={120} error={errors.businessName} />
      </div>
      <Textarea label="How can we help?" name="message" required minLength={10} maxLength={2000} rows={5} error={errors.message} />
      <Turnstile onToken={onToken} />
      <Button type="submit" loading={loading} disabled={!!TURNSTILE_SITE_KEY && !captcha}>
        Send message
      </Button>
    </form>
  );
}

// ---------- Privacy ----------

export function PrivacyPage() {
  return (
    <PublicShell title="Privacy Policy">
      <Doc title="Privacy Policy">
        <p>
          {BRAND} provides digital loyalty cards, a Google review helper and customer tools for local shops in India. This policy explains what personal data we collect,
          why, who we share it with, and the choices you have. It is written with the Digital Personal Data Protection Act, 2023 (India) in mind.
        </p>

        <h2>1. Data we collect</h2>
        <p>
          <b>Shop owners and staff:</b> name, email address, password (stored only as a secure hash), business details you enter (shop name, category, address, phone, logo),
          the Google Maps listing you choose for your shop, and records of plan payments (processed by Razorpay; we never see or store card or UPI details).
        </p>
        <p>
          <b>Customers:</b> name and mobile number when you join a shop's loyalty card; optionally email and birthday; your cards, stamps, rewards and visit history; your
          WhatsApp/SMS/email marketing choices for each shop; and, if you use the review helper, the rating, keywords and note you choose and the drafts generated for you.
        </p>
        <p>
          <b>Technical data:</b> a session cookie to keep you signed in, and basic logs (such as IP address and time) used for security and to prevent abuse. We do not use
          advertising trackers.
        </p>

        <h2>2. How we use it</h2>
        <ul>
          <li>To run loyalty cards: adding stamps, unlocking and redeeming rewards, and showing your cards to you.</li>
          <li>To let the shop you joined see your name, mobile number and visits at that shop, so it can serve you.</li>
          <li>To send WhatsApp or other marketing messages from a shop <b>only if you agreed</b> to receive them. You can withdraw consent at any time.</li>
          <li>To help you write a Google review when you ask for it. You post the review yourself on Google; we never post on your behalf.</li>
          <li>To give shops analytics about their own program, to keep the service secure, and to detect fraud such as fake stamps.</li>
        </ul>

        <h2>3. Who we share it with</h2>
        <p>We do not sell personal data. We share it only as needed to provide the service:</p>
        <ul>
          <li><b>The shop</b> whose loyalty card you joined (only data for that shop).</li>
          <li><b>Cloudflare</b>: hosting, database and the AI that writes review drafts.</li>
          <li><b>Google</b>: shop search on Google Maps (for owners), Google Wallet if you choose to add your card, and Google Fonts for the website's fonts.</li>
          <li><b>Meta (WhatsApp Business)</b>: only when a shop sends you a message you agreed to receive.</li>
          <li><b>Razorpay</b>: plan payments made by shop owners.</li>
          <li><b>Twilio</b>: if mobile verification codes are switched on.</li>
          <li>Authorities, if required by law.</li>
        </ul>

        <h2>4. How long we keep it</h2>
        <p>
          We keep your data while your account or card is active. If you delete your data, we remove your name and mobile number and keep only anonymous records that shops
          need for their accounts (for example, that a reward was redeemed).
        </p>

        <h2>5. Your rights</h2>
        <ul>
          <li>Access and correct your data. Customers can edit their details in My cards → Settings.</li>
          <li>
            Delete your data: customers can use <b>My cards → Settings → Delete my data</b>. Shop owners can ask us through the <Link to="/support" className="text-brand-600 underline">support page</Link>.
          </li>
          <li>Withdraw marketing consent for any shop at any time.</li>
          <li>Raise a grievance with us. If you aren't satisfied, you can complain to the Data Protection Board of India.</li>
        </ul>

        <h2>6. Security</h2>
        <p>Data is encrypted in transit (HTTPS). Passwords are hashed, access is limited by role, and card QR codes are signed to prevent tampering.</p>

        <h2>7. Children</h2>
        <p>The service is meant for people aged 18 or over. Children should use it only with a parent or guardian's consent.</p>

        <h2>8. Changes</h2>
        <p>We will update this page when our practices change and show the new date at the top.</p>

        <h2>9. Contact and grievances</h2>
        <p>
          For privacy questions, data requests or grievances, use the <Link to="/support#contact" className="text-brand-600 underline">contact form</Link> and choose
          “Privacy or data request”.
        </p>
      </Doc>
    </PublicShell>
  );
}

// ---------- Terms ----------

export function TermsPage() {
  return (
    <PublicShell title="Terms of Service">
      <Doc title="Terms of Service">
        <p>These terms apply when you use {BRAND} as a shop owner, shop staff member or customer. By using the service you agree to them.</p>

        <h2>1. The service</h2>
        <p>
          {BRAND} lets shops run digital stamp/loyalty cards, invite customers to share honest Google reviews, manage customers and send messages to customers who agreed to
          receive them. Customers use their cards in a web browser or Google Wallet; no app is required.
        </p>

        <h2>2. Accounts</h2>
        <ul>
          <li>Keep your login details safe. You are responsible for activity on your account and your staff's accounts.</li>
          <li>Give accurate information about yourself and your business.</li>
        </ul>

        <h2>3. Shop owners' responsibilities</h2>
        <ul>
          <li>Rewards and offers are provided by your shop, not by {BRAND}. Describe them honestly and honour rewards your customers have earned.</li>
          <li>Follow Google's review policies: do not offer stamps, discounts or anything else in exchange for reviews, and do not ask only happy customers to review.</li>
          <li>Send marketing messages only to customers who agreed to receive them, and follow WhatsApp's Business and Commerce policies.</li>
          <li>Use customer data only to serve your customers, and follow applicable laws including the Digital Personal Data Protection Act, 2023.</li>
        </ul>

        <h2>4. Customers</h2>
        <ul>
          <li>Each loyalty program belongs to the shop that runs it. A shop may change or end its program; questions about a reward should go to the shop.</li>
          <li>Do not share, copy or misuse another person's card or QR code.</li>
          <li>
            Review drafts are suggestions written by AI from what you choose. Check and edit them before posting. What you post on Google is your own review and is subject to
            Google's terms.
          </li>
        </ul>

        <h2>5. Acceptable use</h2>
        <p>
          Do not misuse the service: no fake stamps or reviews, spam, attempts to break security, scraping, or illegal activity. We may suspend accounts or businesses that
          break these terms.
        </p>

        <h2>6. Plans and payments</h2>
        <ul>
          <li>Paid plans are charged in Indian Rupees through Razorpay and cover 30 days. They do not renew automatically.</li>
          <li>Plan limits (for example customers, staff or AI drafts per month) are shown on the pricing page and may change with notice.</li>
          <li>Payments are non-refundable except where required by law or if we fail to provide the service you paid for.</li>
        </ul>

        <h2>7. Availability</h2>
        <p>We work to keep the service running but do not guarantee it will always be available or error-free. Third-party services (Google, WhatsApp, Razorpay) are outside our control.</p>

        <h2>8. Liability</h2>
        <p>
          To the extent allowed by law, {BRAND} is not liable for indirect losses, lost profits, or disputes between shops and their customers. Our total liability is limited
          to the amount the shop paid us in the 3 months before the claim.
        </p>

        <h2>9. Ending your use</h2>
        <p>You can stop using the service at any time. Customers can delete their data from Settings; shop owners can contact support to close their account.</p>

        <h2>10. Law</h2>
        <p>These terms are governed by the laws of India.</p>

        <h2>11. Contact</h2>
        <p>
          Questions? Use the <Link to="/support#contact" className="text-brand-600 underline">support page</Link>.
        </p>
      </Doc>
    </PublicShell>
  );
}
