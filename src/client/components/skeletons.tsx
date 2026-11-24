import type { ReactNode } from "react";
import { cx } from "./ui";

/**
 * Skeleton loading: grey shapes of the real content with a soft shimmer (no shimmer when the phone asks
 * for reduced motion). Screen readers hear "Loading…" once per screen.
 */
export function Skeleton({ className, rounded = "rounded-lg" }: { className?: string; rounded?: string }) {
  return <div aria-hidden className={cx("skeleton", rounded, className)} />;
}

export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3", i === lines - 1 && lines > 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}

function Loading({ children, label = "Loading…" }: { children: ReactNode; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

// ---------- Customer side ----------

/** The purple loyalty card shape. */
export function LoyaltyCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={cx("skeleton-card rounded-2xl p-5", compact ? "h-[124px]" : "")}>
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-white/30" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-1/2 rounded bg-white/35" />
          <div className="h-2.5 w-1/3 rounded bg-white/25" />
        </div>
        <div className="h-7 w-8 rounded bg-white/30" />
      </div>
      {compact ? (
        <div className="mt-5 h-2 rounded-full bg-white/25" />
      ) : (
        <div className="mt-5 grid grid-cols-5 gap-2">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="aspect-square rounded-full border-2 border-dashed border-white/35" />
          ))}
        </div>
      )}
    </div>
  );
}

export function CustomerShellSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-brand-50 to-zinc-50">
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-6">{children}</div>
    </div>
  );
}

export function CardsListSkeleton() {
  return (
    <Loading label="Loading your cards…">
      <div className="space-y-4">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-3xl bg-white p-3 shadow-sm ring-1 ring-zinc-100">
            <LoyaltyCardSkeleton compact />
            <div className="mt-3 flex items-center gap-2 px-1">
              <Skeleton className="h-10 flex-1" rounded="rounded-xl" />
              <Skeleton className="size-10" rounded="rounded-full" />
              <Skeleton className="size-10" rounded="rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function CardsPageSkeleton() {
  return (
    <CustomerShellSkeleton>
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="size-6" rounded="rounded-full" />
      </div>
      <Skeleton className="mb-2 h-7 w-40" />
      <Skeleton className="mb-6 h-4 w-64" />
      <CardsListSkeleton />
    </CustomerShellSkeleton>
  );
}

export function CardDetailSkeleton() {
  return (
    <CustomerShellSkeleton>
      <Loading label="Loading your card…">
        <Skeleton className="mb-5 h-4 w-24" />
        <LoyaltyCardSkeleton />
        <div className="mt-5 flex flex-col items-center rounded-2xl bg-white p-5 shadow-sm">
          <Skeleton className="size-52" rounded="rounded-xl" />
          <Skeleton className="mt-4 h-3 w-40" />
        </div>
        <div className="mt-4 space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <Skeleton className="h-4 w-24" />
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-9" rounded="rounded-full" />
              <SkeletonText lines={2} className="flex-1" />
            </div>
          ))}
        </div>
      </Loading>
    </CustomerShellSkeleton>
  );
}

export function ShopPageSkeleton() {
  return (
    <CustomerShellSkeleton>
      <Loading label="Loading shop…">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16" rounded="rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24" rounded="rounded-2xl" />
          ))}
        </div>
        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="skeleton-card h-36 rounded-none" />
          <div className="space-y-3 p-5">
            <SkeletonText lines={2} />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </Loading>
    </CustomerShellSkeleton>
  );
}

// ---------- Dashboard ----------

export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-2xl border border-zinc-200 bg-white p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-14" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3 last:border-0">
          <Skeleton className="size-9" rounded="rounded-full" />
          <SkeletonText lines={2} className="flex-1" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Generic dashboard page: header + content blocks. Used while a page's code loads. */
export function DashboardPageSkeleton() {
  return (
    <Loading>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-72" />
      <div className="mt-6 space-y-6">
        <StatTilesSkeleton />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 lg:col-span-2">
            <Skeleton className="h-4 w-32" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-7" rounded="rounded-full" />
                <SkeletonText lines={1} className="flex-1" />
              </div>
            ))}
          </div>
          <Skeleton className="h-48" rounded="rounded-2xl" />
        </div>
      </div>
    </Loading>
  );
}

/** Editor pages: form on the left, phone on the right. */
export function EditorSkeleton() {
  return (
    <Loading>
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ))}
        </div>
        <div className="mx-auto hidden w-full max-w-[340px] rounded-[2.6rem] border-[10px] border-zinc-200 p-4 lg:block">
          <LoyaltyCardSkeleton />
          <SkeletonText lines={3} className="mt-4" />
        </div>
      </div>
    </Loading>
  );
}

/** Whole dashboard (sidebar + page) while the dashboard code itself loads. */
export function DashboardShellSkeleton() {
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white p-4 lg:fixed lg:inset-y-0 lg:block">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9" />
          <Skeleton className="h-4 w-28" />
        </div>
        <Skeleton className="mt-4 h-10 w-full" rounded="rounded-xl" />
        <div className="mt-5 space-y-2.5">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </aside>
      <div className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:hidden">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-20" />
      </div>
      <main className="flex-1 lg:pl-64">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
          <DashboardPageSkeleton />
        </div>
      </main>
    </div>
  );
}

/** Simple centered pages (login, landing, legal) while their code loads. */
export function SimplePageSkeleton() {
  return (
    <div className="flex min-h-dvh items-start justify-center px-4 pt-20" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="mx-auto h-8 w-32" />
        <Skeleton className="mx-auto h-5 w-48" />
        <Skeleton className="h-64 w-full" rounded="rounded-2xl" />
      </div>
    </div>
  );
}
