import { Link, Navigate, useSearchParams } from "react-router";
import { useMe } from "../lib/queries";
import { cx, PageHeader, PageLoader } from "../components/ui";
import {
  AiUsagePanel,
  BusinessesPanel,
  HealthPanel,
  OverviewPanel,
  PlansPanel,
  RevenuePanel,
  SettingsPanel,
  SubscriptionsPanel,
  SuspiciousPanel,
  TransactionsPanel,
} from "../components/admin-panels";

const TABS = [
  { id: "overview", label: "Overview", Panel: OverviewPanel },
  { id: "businesses", label: "Businesses", Panel: BusinessesPanel },
  { id: "subscriptions", label: "Subscriptions", Panel: SubscriptionsPanel },
  { id: "revenue", label: "Revenue", Panel: RevenuePanel },
  { id: "plans", label: "Plans", Panel: PlansPanel },
  { id: "ai", label: "AI Usage", Panel: AiUsagePanel },
  { id: "transactions", label: "Transactions", Panel: TransactionsPanel },
  { id: "suspicious", label: "Suspicious Activity", Panel: SuspiciousPanel },
  { id: "settings", label: "Settings", Panel: SettingsPanel },
  { id: "health", label: "System Health", Panel: HealthPanel },
] as const;

export function AdminPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const active = TABS.find((t) => t.id === params.get("tab")) ?? TABS[0];

  if (me.isLoading) return <PageLoader />;
  if (me.data?.user.role !== "super_admin") return <Navigate to="/app" replace />;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Super Admin"
        description="Platform-wide management"
        actions={
          <Link to="/app" className="text-sm font-medium text-brand-600 hover:underline">
            Back to app
          </Link>
        }
      />
      <nav aria-label="Admin sections" className="-mx-4 mb-6 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1" role="tablist">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                role="tab"
                aria-selected={active.id === t.id}
                onClick={() => setParams({ tab: t.id }, { replace: true })}
                className={cx(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  active.id === t.id ? "border-brand-500 text-brand-700" : "border-transparent text-zinc-500 hover:text-zinc-800",
                )}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section role="tabpanel" aria-label={active.label}>
        <active.Panel />
      </section>
    </div>
  );
}
