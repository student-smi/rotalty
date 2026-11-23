import { Link } from "react-router";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatDateTime, stampEmoji, type Program } from "../lib/loyalty-api";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Spinner } from "../components/ui";
import { useBusinessContext } from "./business";

interface RedemptionRow {
  id: string;
  rewardName: string;
  pointsUsed: number;
  createdAt: string;
  cardId: string;
  customerName: string;
  staffName: string | null;
}

export function RewardsPage() {
  const { business, membership } = useBusinessContext();
  const base = `/api/businesses/${business.id}`;
  const canRedeem = membership.permissions.includes("rewards.redeem");
  const programs = useQuery({ queryKey: ["programs", business.id], queryFn: () => api<{ programs: Program[] }>(`${base}/programs`) });
  const history = useInfiniteQuery({
    queryKey: ["redemptions", business.id],
    queryFn: ({ pageParam }) =>
      api<{ redemptions: RedemptionRow[]; nextBefore: number | null }>(`${base}/redemptions${pageParam ? `?before=${pageParam}` : ""}`),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const rows = history.data?.pages.flatMap((p) => p.redemptions) ?? [];
  const live = (programs.data?.programs ?? []).filter((p) => p.status !== "archived");

  return (
    <>
      <PageHeader
        title="Rewards"
        description="What customers can earn, and every reward handed out"
        actions={
          canRedeem && (
            <Link to={`/app/b/${business.id}/scan`}>
              <Button>Redeem a reward</Button>
            </Link>
          )
        }
      />
      <div className="space-y-6">
        <Card title="Reward tiers">
          {programs.isLoading ? (
            <div className="flex justify-center py-6 text-zinc-400">
              <Spinner />
            </div>
          ) : !live.length ? (
            <EmptyState
              title="No programs yet"
              action={
                membership.permissions.includes("loyalty.manage") && (
                  <Link to={`/app/b/${business.id}/loyalty`}>
                    <Button variant="secondary">Create a program</Button>
                  </Link>
                )
              }
            />
          ) : (
            <div className="space-y-5">
              {live.map((p) => (
                <div key={p.id}>
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    {stampEmoji(p.stampIcon)} {p.name}
                    {p.status !== "active" && <Badge tone="warning">{p.status}</Badge>}
                  </p>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {p.rewards.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3">
                        <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{r.pointsRequired}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                        {!r.isActive && <Badge>Off</Badge>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Redemption history">
          {history.isLoading ? (
            <div className="flex justify-center py-6 text-zinc-400">
              <Spinner />
            </div>
          ) : history.error ? (
            <Alert>Could not load redemptions.</Alert>
          ) : !rows.length ? (
            <EmptyState title="No rewards redeemed yet" description="Redemptions made from the Scan page appear here." />
          ) : (
            <>
              <ul className="divide-y divide-zinc-100">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="text-xl">🎁</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {r.rewardName} · {r.customerName}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatDateTime(r.createdAt)} · {r.pointsUsed} points{r.staffName ? ` · by ${r.staffName}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {history.hasNextPage && (
                <div className="mt-3 flex justify-center">
                  <Button size="sm" variant="secondary" loading={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
