import { Navigate, Outlet, useLocation } from "react-router";
import { authClient } from "../lib/auth";
import { DashboardShellSkeleton, SimplePageSkeleton } from "../components/skeletons";

/** Staff/owner area: sends signed-out visitors to the login page. */
export function RequireAuth() {
  const { data, isPending } = authClient.useSession();
  const location = useLocation();
  if (isPending) return location.pathname.startsWith("/app/b/") ? <DashboardShellSkeleton /> : <SimplePageSkeleton />;
  if (!data) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <Outlet />;
}

/** Login/sign-up pages: signed-in users go straight to their dashboard. */
export function GuestOnly() {
  const { data, isPending } = authClient.useSession();
  if (isPending) return <SimplePageSkeleton />;
  if (data) return <Navigate to="/app" replace />;
  return <Outlet />;
}
