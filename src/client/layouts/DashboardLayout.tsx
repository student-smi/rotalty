import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "../lib/auth";
import { api } from "../lib/api";
import { useBusiness, useMe } from "../lib/queries";
import { Alert, cx } from "../components/ui";
import { DashboardShellSkeleton } from "../components/skeletons";
import type { Permission } from "../../shared/permissions";

type NavGroup = "Today" | "Loyalty" | "Grow" | "Account";

interface NavItem {
  to: string;
  label: string;
  group: NavGroup;
  icon: string;
  /** Visible if the member has any of these. */
  permission?: Permission | Permission[];
}

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z",
  gift: "M20 12v8H4v-8M2 7h20v5H2zM12 20V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  star: "m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.6 3 1-6.1L3 9.5l6.3-.9z",
  message: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  chart: "M4 20V11M10 20V5M16 20v-8M2 20h20",
  team: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4",
  plan: "M3 8l4 3 5-6 5 6 4-3-2 11H5z",
} as const;

export const NAV_ITEMS: NavItem[] = [
  { to: "", label: "Overview", group: "Today", icon: ICONS.home },
  { to: "scan", label: "Scan & Issue", group: "Today", icon: ICONS.scan, permission: ["points.issue", "rewards.redeem"] },
  { to: "loyalty", label: "Stamp cards", group: "Loyalty", icon: ICONS.card, permission: "loyalty.manage" },
  { to: "qr-nfc", label: "QR posters & NFC", group: "Loyalty", icon: ICONS.qr, permission: "loyalty.manage" },
  { to: "rewards", label: "Rewards", group: "Loyalty", icon: ICONS.gift, permission: ["rewards.redeem", "customers.view"] },
  { to: "customers", label: "Customers", group: "Grow", icon: ICONS.users, permission: "customers.view" },
  { to: "reviews", label: "Google reviews", group: "Grow", icon: ICONS.star, permission: "reviews.manage" },
  { to: "marketing", label: "WhatsApp messages", group: "Grow", icon: ICONS.message, permission: "campaigns.manage" },
  { to: "analytics", label: "Analytics", group: "Grow", icon: ICONS.chart, permission: "analytics.view" },
  { to: "staff", label: "Team", group: "Account", icon: ICONS.team, permission: "staff.manage" },
  { to: "settings", label: "Shop settings", group: "Account", icon: ICONS.settings },
  { to: "subscription", label: "Plan & billing", group: "Account", icon: ICONS.plan, permission: "billing.manage" },
];

const GROUPS: NavGroup[] = ["Today", "Loyalty", "Grow", "Account"];

function NavIcon({ d, className }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("size-4.5 shrink-0", className)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function canSee(item: NavItem, permissions: Permission[]) {
  if (!item.permission) return true;
  const needed = Array.isArray(item.permission) ? item.permission : [item.permission];
  return needed.some((p) => permissions.includes(p));
}

export function DashboardLayout() {
  const { businessId = "" } = useParams();
  const { data, isLoading, error } = useBusiness(businessId);
  const me = useMe();
  const platform = useQuery({
    queryKey: ["platform-status"],
    queryFn: () => api<{ maintenanceMessage: string | null }>("/api/billing/platform-status"),
    staleTime: 5 * 60_000,
  });
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  if (isLoading) return <DashboardShellSkeleton />;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-md p-6">
        <Alert>We couldn't open this business. It may not exist or you may no longer have access.</Alert>
        <Link to="/app" className="mt-4 inline-block text-sm font-medium text-brand-600">Go to my businesses</Link>
      </div>
    );
  }

  const { business, membership } = data;
  const items = NAV_ITEMS.filter((i) => canSee(i, membership.permissions));
  const multiple = (me.data?.memberships.length ?? 0) > 1;
  const canScan = membership.permissions.includes("points.issue") || membership.permissions.includes("rewards.redeem");

  async function signOut() {
    await authClient.signOut();
    qc.clear();
    navigate("/login", { replace: true });
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        {business.logoUrl ? (
          <img src={business.logoUrl} alt="" className="size-9 rounded-lg border border-zinc-200 object-cover" />
        ) : (
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand-500 font-semibold text-white">{business.name[0]}</div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{business.name}</p>
          {multiple ? (
            <Link to="/app" className="text-xs text-brand-600 hover:underline">Switch business</Link>
          ) : (
            <p className="text-xs capitalize text-zinc-500">{membership.role}</p>
          )}
        </div>
      </div>
      {canScan && (
        <div className="px-3 pb-2">
          <Link
            to="scan"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
          >
            <NavIcon d={ICONS.scan} /> Scan customer card
          </Link>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {GROUPS.map((group) => {
          const groupItems = items.filter((i) => i.group === group);
          if (!groupItems.length) return null;
          return (
            <div key={group} className="mt-3">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{group}</p>
              <ul className="space-y-0.5">
                {groupItems.map((item) => (
                  <li key={item.label}>
                    <NavLink
                      to={item.to}
                      end={item.to === ""}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cx(
                          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                          isActive ? "bg-brand-50 font-medium text-brand-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                        )
                      }
                    >
                      <NavIcon d={item.icon} />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-zinc-100 p-3">
        <p className="truncate px-2 text-xs text-zinc-500">{me.data?.user.email}</p>
        {me.data?.user.role === "super_admin" && (
          <Link to="/admin" className="mt-1 block rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">Super Admin</Link>
        )}
        <button onClick={signOut} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-sm text-zinc-600 hover:bg-zinc-100">
          Sign out
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white lg:fixed lg:inset-y-0 lg:block">{sidebar}</aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <span className="truncate font-semibold">{business.name}</span>
        <div className="flex items-center gap-1">
          {canScan && (
            <Link to="scan" className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white">
              <NavIcon d={ICONS.scan} className="size-4" /> Scan
            </Link>
          )}
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100" aria-label="Open menu">
            <svg viewBox="0 0 20 20" className="size-5" fill="currentColor"><path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Zm0 5.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" /></svg>
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-zinc-900/40" />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>{sidebar}</aside>
        </div>
      )}

      <main className="flex-1 lg:pl-64">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
          {platform.data?.maintenanceMessage && (
            <div className="mb-6">
              <Alert tone="info">{platform.data.maintenanceMessage}</Alert>
            </div>
          )}
          {business.status === "suspended" && (
            <div className="mb-6">
              <Alert tone="warning">
                This business is suspended{business.suspendedReason ? `: ${business.suspendedReason}` : ""}. Contact support to restore access.
              </Alert>
            </div>
          )}
          <Outlet context={data} />
        </div>
      </main>
    </div>
  );
}
