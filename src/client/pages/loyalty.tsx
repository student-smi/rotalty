import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDate, stampEmoji, type Program } from "../lib/loyalty-api";
import type { ProgramStatus } from "../../shared/domain";
import { Alert, Badge, Button, cx, EmptyState, ListLoader, PageHeader } from "../components/ui";
import { LoyaltyCard } from "../components/LoyaltyCard";
import { useBusinessContext } from "./business";

const STATUS: Record<ProgramStatus, { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  draft: { label: "Draft", tone: "neutral" },
  archived: { label: "Ended", tone: "danger" },
};

export function LoyaltyProgramsPage() {
  const { business, membership } = useBusinessContext();
  const canManage = membership.permissions.includes("loyalty.manage");
  const base = `/app/b/${business.id}/loyalty`;
  const { data, isLoading, error } = useQuery({
    queryKey: ["programs", business.id],
    queryFn: () => api<{ programs: Program[] }>(`/api/businesses/${business.id}/programs`),
  });

  return (
    <>
      <PageHeader
        title="Stamp cards"
        description="Digital stamp cards your customers collect on every visit"
        actions={
          canManage && (
            <Link to={`${base}/new`}>
              <Button>+ New stamp card</Button>
            </Link>
          )
        }
      />
      {isLoading ? (
        <ListLoader />
      ) : error ? (
        <Alert>Could not load your stamp cards. Please refresh.</Alert>
      ) : !data?.programs.length ? (
        <EmptyState
          title="No stamp card yet"
          description="Create your first one, for example “Buy 9 coffees, get the 10th free”. You'll see a live preview while you build it."
          action={
            canManage && (
              <Link to={`${base}/new`}>
                <Button>Create stamp card</Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {data.programs.map((p) => {
            const active = p.rewards.filter((r) => r.isActive);
            const card = (
              <article className={cx("h-full rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition", canManage && "hover:border-brand-400 hover:shadow-md")}>
                <LoyaltyCard
                  businessName={business.name}
                  logoUrl={business.logoUrl}
                  programName={p.name}
                  stampIcon={p.stampIcon}
                  stampsRequired={p.stampsRequired}
                  points={Math.min(3, p.stampsRequired - 1)}
                  rewards={active}
                  compact
                />
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="text-sm text-zinc-500">
                      {stampEmoji(p.stampIcon)} {p.stampsRequired} stamps · {active.length ? active.map((r) => r.name).join(", ") : "No active reward"}
                    </p>
                    {p.endsAt && <p className="text-xs text-zinc-400">Ends {formatDate(p.endsAt)}</p>}
                  </div>
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                </div>
                {canManage && <p className="mt-3 text-sm font-medium text-brand-600">Edit card →</p>}
              </article>
            );
            return canManage ? (
              <Link key={p.id} to={`${base}/${p.id}`} className="block">
                {card}
              </Link>
            ) : (
              <div key={p.id}>{card}</div>
            );
          })}
        </div>
      )}
    </>
  );
}
