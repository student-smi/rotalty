import { useEffect, useState, useSyncExternalStore } from "react";
import { canPromptInstall, isAndroid, isInAppBrowser, isIos, isStandalone, justInstalled, promptInstall, subscribePwa } from "../lib/pwa";

const DISMISS_KEY = "graahak.installPrompt.dismissedAt";
const DISMISS_DAYS = 14;

function readDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return !!at && Date.now() - at < DISMISS_DAYS * 86400_000;
  } catch {
    return false;
  }
}

type Mode = "prompt" | "ios" | "inapp" | "android-menu" | "done" | null;

/** "Add My cards to Home Screen": native prompt on Android/Chrome, instructions on iPhone and other browsers. */
export function InstallCardPrompt() {
  const canPrompt = useSyncExternalStore(subscribePwa, canPromptInstall, () => false);
  const installed = useSyncExternalStore(subscribePwa, justInstalled, () => false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [standalone, setStandalone] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => setStandalone(isStandalone()), []);

  const mode: Mode = installed
    ? "done"
    : standalone
      ? null
      : isInAppBrowser()
        ? "inapp"
        : canPrompt
          ? "prompt"
          : isIos()
            ? "ios"
            : isAndroid()
              ? "android-menu"
              : null;

  if (!mode || (dismissed && mode !== "done")) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private mode: the card simply shows again next time.
    }
  }

  if (mode === "done") {
    return (
      <div className="mt-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">
        ✅ Added! Open <b>“My cards”</b> from your home screen next time.
      </div>
    );
  }

  return (
    <div className="relative mt-3 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
      <button type="button" onClick={dismiss} className="absolute right-2 top-2 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600" aria-label="Not now">
        <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
        </svg>
      </button>
      <div className="flex items-start gap-3 pr-6">
        <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-zinc-900">Keep your card one tap away</p>
          <p className="text-sm text-zinc-600">Add “My cards” to your home screen. It opens like an app, no download needed.</p>
        </div>
      </div>

      {mode === "prompt" && (
        <button
          type="button"
          onClick={() => void promptInstall()}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-white transition hover:bg-brand-600"
        >
          📲 Add to Home Screen
        </button>
      )}

      {mode !== "prompt" && (
        <>
          {!showSteps ? (
            <button type="button" onClick={() => setShowSteps(true)} className="mt-3 h-11 w-full rounded-xl bg-brand-50 text-sm font-semibold text-brand-700 hover:bg-brand-100">
              📲 Show me how
            </button>
          ) : (
            <ol className="mt-3 space-y-2 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700">
              {mode === "ios" && (
                <>
                  <Step n={1}>
                    Tap the <b>Share</b> button <ShareIcon /> at the bottom (or top) of the screen.
                  </Step>
                  <Step n={2}>
                    Scroll down and tap <b>“Add to Home Screen”</b>.
                  </Step>
                  <Step n={3}>
                    Tap <b>Add</b>. The first time you open it, enter your mobile number once to see your cards.
                  </Step>
                </>
              )}
              {mode === "android-menu" && (
                <>
                  <Step n={1}>
                    Tap the browser menu <b>⋮</b> at the top right.
                  </Step>
                  <Step n={2}>
                    Tap <b>“Add to Home screen”</b> or <b>“Install app”</b>.
                  </Step>
                  <Step n={3}>
                    Tap <b>Add</b>.
                  </Step>
                </>
              )}
              {mode === "inapp" && (
                <>
                  <Step n={1}>
                    This page is open inside another app. Tap the menu <b>⋮</b> or <b>…</b> and choose <b>“Open in browser”</b> (Chrome or Safari).
                  </Step>
                  <Step n={2}>Then come back to this card and add it to your home screen from there.</Step>
                </>
              )}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-semibold text-white">{n}</span>
      <span>{children}</span>
    </li>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mx-0.5 inline size-4 -translate-y-px text-brand-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
