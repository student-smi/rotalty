import { useEffect, useState } from "react";
import { QuickReview, useReviewInfo } from "./QuickReview";
import { Alert } from "./ui";
import { Skeleton } from "./skeletons";

/** "Share your experience on Google" button under a loyalty card, opening the review helper in a bottom sheet. */
export function GoogleReviewButton({ slug, businessName, pill }: { slug: string; businessName: string; /** Small "⭐ Review" button for the cards list. */ pill?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {pill ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Review ${businessName} on Google`}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
        >
          <span aria-hidden>⭐</span> Review
        </button>
      ) : (
        <ReviewButtonFace onClick={() => setOpen(true)} />
      )}
      {open && <ReviewSheet slug={slug} businessName={businessName} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The button's look, shared with the dashboard preview. */
export function ReviewButtonFace({ onClick }: { onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white p-4 text-left shadow-sm transition hover:border-amber-300"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xl" aria-hidden>
        ⭐
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-zinc-900">Share your experience on Google</span>
        <span className="block text-sm text-zinc-600">Pick a few words, we'll help you write it</span>
      </span>
      <span className="text-zinc-400" aria-hidden>
        ›
      </span>
    </Tag>
  );
}

function ReviewSheet({ slug, businessName, onClose }: { slug: string; businessName: string; onClose: () => void }) {
  const info = useReviewInfo(slug);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Review ${businessName} on Google`}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pb-8 pt-3 shadow-xl sm:max-w-lg sm:rounded-3xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-200 sm:hidden" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Review {businessName}</h2>
            <p className="text-sm text-zinc-500">Takes about 30 seconds</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close">
            <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        {info.isLoading ? (
          <div className="space-y-5" role="status" aria-busy="true">
            <span className="sr-only">Loading…</span>
            <Skeleton className="h-4 w-40" />
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20" rounded="rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-4 w-48" />
            <div className="flex flex-wrap gap-2">
              {[70, 96, 84, 110, 76, 90].map((w) => (
                <div key={w} style={{ width: w }}>
                  <Skeleton className="h-8" rounded="rounded-full" />
                </div>
              ))}
            </div>
            <Skeleton className="h-12 w-full" />
          </div>
        ) : info.data ? (
          <QuickReview slug={slug} info={info.data} />
        ) : (
          <Alert>Reviews aren't available for this shop right now.</Alert>
        )}
      </div>
    </div>
  );
}
