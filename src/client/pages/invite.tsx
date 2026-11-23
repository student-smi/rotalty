import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../lib/api";
import { authClient } from "../lib/auth";
import { ROLE_LABELS } from "../lib/labels";
import { Alert, Button, PageLoader } from "../components/ui";

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = authClient.useSession();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api<{ businessName: string; role: "manager" | "staff"; email: string }>(`/api/invitations/${token}`),
    retry: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (invite.isLoading || session.isPending) return <PageLoader />;

  const next = encodeURIComponent(`/invite/${token}`);

  async function accept() {
    setLoading(true);
    setError(null);
    try {
      const { businessId } = await api<{ businessId: string }>(`/api/invitations/${token}/accept`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(`/app/b/${businessId}`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not accept the invitation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 text-center shadow-sm">
        {invite.error || !invite.data ? (
          <>
            <h1 className="text-lg font-semibold">Invitation not available</h1>
            <p className="mt-2 text-sm text-zinc-500">This link is invalid, expired, revoked or already used. Ask the business owner for a new invitation.</p>
            <Link to="/app" className="mt-4 inline-block text-sm font-medium text-brand-600">Go to dashboard</Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Join {invite.data.businessName}</h1>
            <p className="mt-2 text-sm text-zinc-500">
              You've been invited as <strong>{ROLE_LABELS[invite.data.role]}</strong> using <strong>{invite.data.email}</strong>.
            </p>
            {error && <div className="mt-4 text-left"><Alert>{error}</Alert></div>}
            {session.data ? (
              <div className="mt-6 space-y-3">
                <Button className="w-full" onClick={accept} loading={loading}>Accept invitation</Button>
                <p className="text-xs text-zinc-500">Signed in as {session.data.user.email}</p>
              </div>
            ) : (
              <div className="mt-6 space-y-2">
                <Link to={`/signup?next=${next}`}><Button className="w-full">Create account</Button></Link>
                <Link to={`/login?next=${next}`}><Button variant="secondary" className="mt-2 w-full">I already have an account</Button></Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
