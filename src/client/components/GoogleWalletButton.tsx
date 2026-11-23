import { useState } from "react";
import { api, ApiError } from "../lib/api";

const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * "Add to Google Wallet" using Google's official button artwork (public/google-wallet, en-IN),
 * from https://developers.google.com/wallet/generic/resources/brand-guidelines.
 * Hidden on iPhone/iPad (no Google Wallet there).
 */
export function GoogleWalletButton({ cardId }: { cardId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (isIos()) return null;

  async function add() {
    // Open the tab inside the tap so it isn't blocked as a popup.
    const tab = window.open("about:blank", "_blank");
    setLoading(true);
    setError(null);
    try {
      const { saveUrl } = await api<{ saveUrl: string }>(`/api/c/cards/${cardId}/google-wallet`, { method: "POST" });
      if (tab) tab.location.href = saveUrl;
      else window.location.href = saveUrl;
    } catch (err) {
      tab?.close();
      setError(err instanceof ApiError ? err.message : "Couldn't open Google Wallet. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col items-center">
      {/* Official artwork (en-IN) from Google's brand guidelines: black only, never recoloured or reshaped, min 48px tall, 8px clear space. */}
      <button
        type="button"
        onClick={add}
        disabled={loading}
        aria-label="Add to Google Wallet"
        className="rounded-full p-2 transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60"
      >
        <img src="/google-wallet/add-to-google-wallet-en-IN.svg" alt="Add to Google Wallet" className="block h-12 w-auto" width={272} height={48} />
      </button>
      {loading && <p className="text-sm text-zinc-500">Opening Google Wallet…</p>}
      {error && <p className="mt-1 text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
