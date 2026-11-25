import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { authClient, captchaHeaders, TURNSTILE_SITE_KEY } from "../lib/auth";
import { Alert, Button, Input } from "../components/ui";
import { Turnstile } from "../components/Turnstile";
import { Logo } from "../lib/brand";

export function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link to="/" className="mb-6 inline-block" aria-label="Home">
            <Logo />
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">{children}</div>
        {footer && <p className="mt-6 text-center text-sm text-zinc-500">{footer}</p>}
      </div>
    </div>
  );
}

function useCaptcha() {
  const [token, setToken] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setToken(t), []);
  return { token, onToken, ready: !TURNSTILE_SITE_KEY || !!token };
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const captcha = useCaptcha();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    const { error } = await authClient.signIn.email(
      { email: String(f.get("email")), password: String(f.get("password")) },
      { headers: captchaHeaders(captcha.token) },
    );
    setLoading(false);
    if (error) return setError(error.status === 429 ? "Too many attempts. Please wait a minute." : "Incorrect email or password");
    await qc.invalidateQueries();
    navigate(safeNext(params.get("next")), { replace: true });
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Shop owners & staff sign in here"
      footer={
        <>
          New here? <Link className="font-medium text-brand-600 hover:underline" to={`/signup?${params}`}>Create a free account</Link>
          <span className="mt-3 block">
            Customer looking for your stamp card? <Link className="font-medium text-brand-600 hover:underline" to="/c">Open my cards</Link>
          </span>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {params.get("reset") === "1" && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
        {error && <Alert>{error}</Alert>}
        <Input label="Email" name="email" type="email" autoComplete="email" required />
        <Input label="Password" name="password" type="password" autoComplete="current-password" required />
        <div className="text-right text-sm">
          <Link to="/forgot-password" className="text-brand-600 hover:underline">Forgot password?</Link>
        </div>
        <Turnstile onToken={captcha.onToken} />
        <Button type="submit" className="w-full" loading={loading} disabled={!captcha.ready}>Sign in</Button>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const [params] = useSearchParams();
  // Shop name typed in the landing page demo: carried into onboarding step 1.
  const prefillShop = params.get("shop");
  if (prefillShop) {
    try {
      sessionStorage.setItem("repeatly.prefillShop", prefillShop.slice(0, 80));
    } catch {
      // Private mode: the visitor just types it again.
    }
  }
  const navigate = useNavigate();
  const qc = useQueryClient();
  const captcha = useCaptcha();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setLoading(true);
    setError(null);
    const { error } = await authClient.signUp.email(
      { name: String(f.get("name")).trim(), email: String(f.get("email")).trim(), password },
      { headers: captchaHeaders(captcha.token) },
    );
    setLoading(false);
    if (error) {
      return setError(
        error.status === 429
          ? "Too many attempts. Please wait a minute."
          : error.code === "USER_ALREADY_EXISTS" || error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
            ? "An account with this email already exists. Sign in instead."
            : (error.message ?? "Could not create your account"),
      );
    }
    await qc.invalidateQueries();
    navigate(safeNext(params.get("next")), { replace: true });
  }

  return (
    <AuthLayout
      title="Create your free account"
      subtitle="Set up your digital stamp card in about 5 minutes. No card needed."
      footer={<>Already have an account? <Link className="font-medium text-brand-600 hover:underline" to={`/login?${params}`}>Sign in</Link></>}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Input label="Your name" name="name" autoComplete="name" required minLength={2} maxLength={80} />
        <Input label="Email" name="email" type="email" autoComplete="email" required />
        <Input label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters" />
        <Turnstile onToken={captcha.onToken} />
        <Button type="submit" className="w-full" loading={loading} disabled={!captcha.ready}>Create account</Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get("email"));
    setLoading(true);
    setError(null);
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setLoading(false);
    if (error?.status === 429) return setError("Too many attempts. Please wait a minute.");
    setSent(true);
  }

  return (
    <AuthLayout title="Reset your password" footer={<Link className="font-medium text-brand-600 hover:underline" to="/login">Back to sign in</Link>}>
      {sent ? (
        <Alert tone="success">If an account exists for that email, we've sent a reset link. It expires in 1 hour.</Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Button type="submit" className="w-full" loading={loading}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") ? "This reset link is invalid or has expired." : null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const newPassword = String(f.get("password"));
    if (newPassword !== String(f.get("confirm"))) return setError("Passwords do not match");
    if (!token) return setError("This reset link is invalid or has expired.");
    setLoading(true);
    const { error } = await authClient.resetPassword({ newPassword, token });
    setLoading(false);
    if (error) return setError(error.message ?? "This reset link is invalid or has expired.");
    navigate("/login?reset=1", { replace: true });
  }

  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Input label="New password" name="password" type="password" autoComplete="new-password" required minLength={8} />
        <Input label="Confirm password" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        <Button type="submit" className="w-full" loading={loading} disabled={!token}>Update password</Button>
      </form>
    </AuthLayout>
  );
}
