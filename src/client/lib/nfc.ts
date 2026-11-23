export interface NfcCapabilities {
  /** Web NFC (Chrome on Android) can read/write NDEF tags. */
  webNfc: boolean;
  ios: boolean;
  secureContext: boolean;
  /** Browsers cannot emulate an NFC card, so phone-to-phone loyalty taps are never possible on the web. */
  phoneToPhone: false;
}

export function detectNfc(): NfcCapabilities {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return {
    webNfc: typeof window !== "undefined" && "NDEFReader" in window,
    ios: /iPhone|iPad|iPod/i.test(ua),
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    phoneToPhone: false,
  };
}

interface NdefWriter {
  write(message: { records: { recordType: string; data: string }[] }): Promise<void>;
}

/** Must be called from a user gesture. Throws with a readable message on failure. */
export async function writeUrlToTag(url: string): Promise<void> {
  const Ctor = (window as unknown as { NDEFReader?: new () => NdefWriter }).NDEFReader;
  if (!Ctor) throw new Error("This browser can't write NFC tags. Use the NFC Tools app instead.");
  try {
    await new Ctor().write({ records: [{ recordType: "url", data: url }] });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "NotAllowedError") throw new Error("NFC permission was denied. Allow NFC for this site and try again.");
    if (name === "NotSupportedError") throw new Error("NFC isn't available on this device or is switched off.");
    if (name === "AbortError") throw new Error("Writing was cancelled.");
    throw new Error((e as Error)?.message || "Could not write to the tag. Hold the tag still against the back of the phone.");
  }
}
