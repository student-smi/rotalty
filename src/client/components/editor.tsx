import { useEffect, useState, type ReactNode } from "react";
import { Link, useBlocker } from "react-router";
import { Alert, Button, cx } from "./ui";

/**
 * Dashboard edit screens: form on the left, live preview on the right (sticky).
 * On phones an "Edit | Preview" switch shows one at a time, so the preview is one tap away.
 */
export function EditorLayout({
  back,
  title,
  subtitle,
  preview,
  previewLabel = "Live preview",
  previewNote,
  children,
  footer,
}: {
  back?: { to: string; label: string };
  title: string;
  subtitle?: ReactNode;
  preview: ReactNode;
  previewLabel?: string;
  previewNote?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  return (
    <div className="pb-24 lg:pb-0">
      {back && (
        <Link to={back.to} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
          ← {back.label}
        </Link>
      )}
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-zinc-600">{subtitle}</p>}
      </div>

      <div className="mb-4 grid grid-cols-2 rounded-xl bg-zinc-100 p-1 lg:hidden" role="tablist" aria-label="Edit or preview">
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("h-10 rounded-lg text-sm font-semibold transition", tab === t ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500")}
          >
            {t === "edit" ? "✏️ Edit" : "👁 Preview"}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <div className={cx("min-w-0 space-y-5", tab === "preview" && "hidden lg:block")}>{children}</div>
        <aside className={cx("lg:sticky lg:top-6", tab === "edit" && "hidden lg:block")} aria-label={previewLabel}>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden /> {previewLabel}
          </p>
          {preview}
          {previewNote && <p className="mt-3 text-center text-xs text-zinc-500">{previewNote}</p>}
        </aside>
      </div>
      {footer}
    </div>
  );
}

/** Numbered section, styled like the onboarding steps. */
export function EditorSection({ n, title, hint, children, className }: { n?: number; title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm", className)}>
      <div className="mb-4 flex items-start gap-3">
        {n != null && <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-semibold text-white">{n}</span>}
        <div className="min-w-0">
          <h2 className="font-semibold text-zinc-900">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-zinc-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Collapsible "Advanced" section: simple by default, everything still reachable. */
export function AdvancedSection({ title = "Advanced settings", hint, children, defaultOpen }: { title?: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-5 marker:hidden">
        <span className="flex size-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition group-open:rotate-90" aria-hidden>
          ›
        </span>
        <span className="min-w-0">
          <span className="block font-semibold text-zinc-900">{title}</span>
          {hint && <span className="block text-sm text-zinc-500">{hint}</span>}
        </span>
      </summary>
      <div className="border-t border-zinc-100 p-5">{children}</div>
    </details>
  );
}

/** Phone outline so previews look like the customer's screen. */
export function PhoneFrame({ children, className, background = "bg-gradient-to-b from-brand-50 to-zinc-50" }: { children: ReactNode; className?: string; background?: string }) {
  return (
    <div className={cx("mx-auto w-full max-w-[340px] rounded-[2.6rem] border-[10px] border-zinc-900 bg-zinc-900 shadow-xl", className)}>
      <div className={cx("relative h-[600px] overflow-y-auto overflow-x-hidden rounded-[2rem] [scrollbar-width:none]", background)}>
        <div className="sticky top-0 z-10 flex h-7 items-center justify-center" aria-hidden>
          <span className="h-4 w-20 rounded-full bg-zinc-900" />
        </div>
        <div className="px-4 pb-6">{children}</div>
      </div>
    </div>
  );
}

/** Segmented control used inside previews (e.g. New / Halfway / Ready). */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="mt-3 flex justify-center">
      <div className="inline-flex rounded-full bg-zinc-100 p-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("rounded-full px-3 py-1 text-xs font-medium transition", value === o.value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sticky "Unsaved changes · Discard · Save" bar. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  saveLabel = "Save changes",
  error,
  saved,
  disabled,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  saveLabel?: string;
  error?: ReactNode;
  saved?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur lg:sticky lg:bottom-0 lg:mt-6 lg:rounded-2xl lg:border lg:shadow-lg">
      {error && <div className="mb-2">{typeof error === "string" ? <Alert>{error}</Alert> : error}</div>}
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm">
          {dirty ? (
            <span className="flex items-center gap-2 text-amber-700">
              <span className="size-2 rounded-full bg-amber-500" aria-hidden /> Unsaved changes
            </span>
          ) : saved ? (
            <span className="text-emerald-700">✓ All changes saved</span>
          ) : (
            <span className="text-zinc-400">No changes</span>
          )}
        </p>
        {onDiscard && (
          <Button variant="ghost" onClick={onDiscard} disabled={!dirty || saving}>
            Discard
          </Button>
        )}
        <Button onClick={onSave} loading={saving} disabled={!dirty || disabled}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/** Warn before leaving a page (in-app navigation or closing the tab) with unsaved changes. */
export function useUnsavedChangesGuard(dirty: boolean) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("You have unsaved changes. Leave without saving?")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}

/** Compare two JSON-able values (form state vs saved state). */
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
