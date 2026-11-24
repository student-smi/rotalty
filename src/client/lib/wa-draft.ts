import type { ReviewLanguage } from "../../shared/domain";

/** WhatsApp "draft" messages: opens WhatsApp with the text typed in; the owner taps Send. */
export type WaKind = "thanks" | "reward_ready" | "almost_there" | "miss_you" | "birthday" | "offer";
export type WaLang = ReviewLanguage;

export interface WaRecipient {
  customerId: string;
  name: string;
  phone: string;
  programName: string;
  stamps: number;
  stampsRequired: number;
  nextReward: string | null;
  stampsToNext: number | null;
  readyReward: string | null;
  lastVisitAt: number | null;
  lastMessagedAt: number | null;
}

export const WA_KIND_LABELS: Record<WaKind, { label: string; emoji: string }> = {
  thanks: { label: "Thank you for visiting", emoji: "🙏" },
  reward_ready: { label: "Your reward is ready", emoji: "🎉" },
  almost_there: { label: "Almost there", emoji: "⏳" },
  miss_you: { label: "We miss you", emoji: "😊" },
  birthday: { label: "Happy birthday", emoji: "🎂" },
  offer: { label: "Offer / announcement", emoji: "📣" },
};

export const WA_LANG_LABELS: Record<WaLang, string> = { en: "English", hi: "हिन्दी", gu: "ગુજરાતી", hinglish: "Hinglish" };

/** Ready-made texts. Placeholders: {name} {shop} {stamps} {total} {left} {reward} {ready}. Lines with a missing value are dropped. */
export const WA_TEMPLATES: Record<WaLang, Record<Exclude<WaKind, "offer">, string> & { offer: string }> = {
  en: {
    thanks: "Hi {name}! 🙏 Thanks for visiting {shop} today.\nYou have {stamps}/{total} stamps. Just {left} more for {reward}!",
    reward_ready: "Hi {name}! 🎉 Your {ready} is ready at {shop}.\nShow your card on your next visit to claim it.",
    almost_there: "Hi {name}! You're only {left} stamp(s) away from {reward} at {shop}. See you soon! 😊",
    miss_you: "Hi {name}, we miss you at {shop}! 😊\nYour card has {stamps}/{total} stamps saved. Drop by soon!",
    birthday: "Happy Birthday {name}! 🎂\nWishing you a wonderful year from all of us at {shop}.",
    offer: "Hi {name}! 📣 Special offer at {shop} this week: ",
  },
  hi: {
    thanks: "नमस्ते {name} जी! 🙏 आज {shop} आने के लिए धन्यवाद।\nआपके कार्ड पर {stamps}/{total} स्टैम्प हैं। बस {left} और, फिर {reward}!",
    reward_ready: "नमस्ते {name} जी! 🎉 {shop} पर आपका {ready} तैयार है।\nअगली बार आकर अपना कार्ड दिखाएँ।",
    almost_there: "नमस्ते {name} जी! {reward} पाने के लिए सिर्फ़ {left} स्टैम्प बाकी हैं। जल्दी मिलते हैं! 😊",
    miss_you: "नमस्ते {name} जी, {shop} पर हम आपको याद कर रहे हैं! 😊\nआपके कार्ड पर {stamps}/{total} स्टैम्प सुरक्षित हैं।",
    birthday: "जन्मदिन की हार्दिक शुभकामनाएँ {name} जी! 🎂\n{shop} की ओर से आपको ढेर सारी शुभकामनाएँ।",
    offer: "नमस्ते {name} जी! 📣 इस हफ़्ते {shop} पर खास ऑफ़र: ",
  },
  gu: {
    thanks: "નમસ્તે {name}! 🙏 આજે {shop} પર આવવા બદલ આભાર.\nતમારા કાર્ડ પર {stamps}/{total} સ્ટેમ્પ છે. હવે ફક્ત {left} બાકી, પછી {reward}!",
    reward_ready: "નમસ્તે {name}! 🎉 {shop} પર તમારું {ready} તૈયાર છે.\nઆવતી વખતે તમારું કાર્ડ બતાવજો.",
    almost_there: "નમસ્તે {name}! {reward} માટે ફક્ત {left} સ્ટેમ્પ બાકી છે. જલ્દી મળીએ! 😊",
    miss_you: "નમસ્તે {name}, {shop} પર અમે તમને યાદ કરીએ છીએ! 😊\nતમારા કાર્ડ પર {stamps}/{total} સ્ટેમ્પ સાચવેલા છે.",
    birthday: "જન્મદિવસની હાર્દિક શુભેચ્છા {name}! 🎂\n{shop} તરફથી ખૂબ ખૂબ શુભેચ્છાઓ.",
    offer: "નમસ્તે {name}! 📣 આ અઠવાડિયે {shop} પર ખાસ ઓફર: ",
  },
  hinglish: {
    thanks: "Hi {name}! 🙏 Aaj {shop} aane ke liye thank you.\nAapke card par {stamps}/{total} stamps hain. Bas {left} aur, phir {reward}!",
    reward_ready: "Hi {name}! 🎉 {shop} par aapka {ready} ready hai.\nAgli baar card dikha kar le lijiye.",
    almost_there: "Hi {name}! {reward} ke liye bas {left} stamps baaki hain. Jaldi milte hain! 😊",
    miss_you: "Hi {name}, {shop} par hum aapko miss kar rahe hain! 😊\nAapke card par {stamps}/{total} stamps saved hain.",
    birthday: "Happy Birthday {name}! 🎂\n{shop} ki taraf se bahut saari shubhkamnayein.",
    offer: "Hi {name}! 📣 Is hafte {shop} par special offer: ",
  },
};

const CARD_LINK_LINE: Record<WaLang, string> = {
  en: "Your card: {link}",
  hi: "आपका कार्ड: {link}",
  gu: "તમારું કાર્ડ: {link}",
  hinglish: "Aapka card: {link}",
};

export interface WaVars {
  name: string;
  shop: string;
  stamps: number;
  total: number;
  left: number | null;
  reward: string | null;
  ready: string | null;
  link?: string;
}

export function varsFor(r: WaRecipient, shop: string, link?: string): WaVars {
  return {
    name: r.name.split(" ")[0] ?? r.name,
    shop,
    stamps: r.stamps,
    total: r.stampsRequired,
    left: r.stampsToNext,
    reward: r.nextReward,
    ready: r.readyReward,
    link,
  };
}

/** Fill placeholders. A sentence whose placeholder has no value (e.g. no next reward) is dropped, never left half-empty. */
export function fillMessage(template: string, v: WaVars, lang: WaLang, withLink: boolean) {
  const map: Record<string, string | null> = {
    name: v.name,
    shop: v.shop,
    stamps: String(v.stamps),
    total: String(v.total),
    left: v.left != null ? String(v.left) : null,
    reward: v.reward,
    ready: v.ready,
    link: v.link ?? null,
  };
  const text = withLink && v.link ? `${template}\n\n${CARD_LINK_LINE[lang]}` : template;
  const placeholder = /\{(name|shop|stamps|total|left|reward|ready|link)\}/g;
  return text
    .split("\n")
    .map((line) =>
      line
        .split(/(?<=[.!?।])\s+/)
        .filter((sentence) => [...sentence.matchAll(placeholder)].every((m) => map[m[1]!]))
        .map((sentence) => sentence.replace(placeholder, (_, k: string) => map[k]!))
        .join(" "),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** wa.me link with the message pre-typed. Indian 10-digit numbers get the +91 country code. */
export function waLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}

const PREF_KEY = "graahak.wa.prefs";
export function loadWaPrefs(): { lang: WaLang; withLink: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
    if (p && ["en", "hi", "gu", "hinglish"].includes(p.lang)) return { lang: p.lang, withLink: p.withLink !== false };
  } catch {
    // ignore
  }
  return { lang: "en", withLink: true };
}
export function saveWaPrefs(p: { lang: WaLang; withLink: boolean }) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // Private mode: preference isn't remembered.
  }
}
