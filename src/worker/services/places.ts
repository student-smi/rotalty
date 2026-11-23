import { AppError } from "../lib/errors";
import type { BusinessCategory } from "../../shared/permissions";

/**
 * Google Places API (New) — server-side proxy so the API key never reaches the browser.
 * https://developers.google.com/maps/documentation/places/web-service/op-overview
 *
 * Billing: Autocomplete requests that end in a Place Details call with the same `sessionToken`
 * are billed as one session. The details field mask below uses Essentials, Pro and Enterprise
 * fields (phone, website, rating), so each completed search is one Place Details Enterprise call.
 */
const BASE = "https://places.googleapis.com/v1";

const DETAILS_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "shortFormattedAddress",
  "addressComponents",
  "location",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "googleMapsUri",
  "nationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
].join(",");

export interface PlaceSuggestion {
  placeId: string;
  name: string;
  secondary: string;
}

export interface PlaceDetails {
  placeId: string;
  name: string;
  category: BusinessCategory;
  categoryLabel: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  /** 10-digit Indian mobile number, or null if the listing has a landline / toll-free number. */
  phone: string | null;
  /** The number exactly as Google lists it, for display. */
  phoneDisplay: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUri: string | null;
  /** Google's documented "write a review" link for a place id. */
  reviewUrl: string;
  rating: number | null;
  userRatingCount: number | null;
}

interface AddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

interface RawPlace {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: AddressComponent[];
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text: string };
  types?: string[];
  googleMapsUri?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
}

export const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

export const placesEnabled = (env: Env) => !!env.GOOGLE_PLACES_API_KEY;

function apiKey(env: Env) {
  if (!env.GOOGLE_PLACES_API_KEY) throw new AppError(503, "PLACES_NOT_CONFIGURED", "Google search is not set up yet. Please fill in the details manually.");
  return env.GOOGLE_PLACES_API_KEY;
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    console.error("Places request failed", err);
    throw new AppError(502, "PLACES_UNAVAILABLE", "Google search is not responding. Please try again or fill in the details manually.");
  }
  if (res.status === 404) throw new AppError(404, "NOT_FOUND", "Place not found");
  if (!res.ok) {
    console.error("Places API error", res.status, (await res.text()).slice(0, 500));
    throw new AppError(502, "PLACES_UNAVAILABLE", "Google search is not responding. Please try again or fill in the details manually.");
  }
  return res.json<T>();
}

export async function autocomplete(env: Env, input: string, sessionToken: string): Promise<PlaceSuggestion[]> {
  const body = await call<{ suggestions?: { placePrediction?: { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[] }>(
    `${BASE}/places:autocomplete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey(env) },
      body: JSON.stringify({ input, sessionToken, includedRegionCodes: ["in"], regionCode: "in", languageCode: "en" }),
    },
  );
  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .map((p) => ({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
    }));
}

export async function placeDetails(env: Env, placeId: string, sessionToken?: string): Promise<PlaceDetails> {
  const qs = new URLSearchParams({ languageCode: "en", regionCode: "IN" });
  if (sessionToken) qs.set("sessionToken", sessionToken);
  const raw = await call<RawPlace>(`${BASE}/places/${encodeURIComponent(placeId)}?${qs}`, {
    headers: { "X-Goog-Api-Key": apiKey(env), "X-Goog-FieldMask": DETAILS_FIELDS },
  });
  return normalizePlace(raw);
}

// ---------- normalisation (pure, unit-tested) ----------

const STREET_PARTS = ["subpremise", "premise", "street_number", "route", "neighborhood", "sublocality_level_3", "sublocality_level_2", "sublocality_level_1"];

export function normalizePlace(raw: RawPlace): PlaceDetails {
  const parts = raw.addressComponents ?? [];
  const find = (...types: string[]) => {
    for (const t of types) {
      const hit = parts.find((p) => p.types.includes(t));
      if (hit) return hit.longText;
    }
    return null;
  };

  const street: string[] = [];
  for (const p of parts) {
    if (p.types.some((t) => STREET_PARTS.includes(t)) && !street.includes(p.longText)) street.push(p.longText);
  }
  const city = find("locality", "administrative_area_level_3", "administrative_area_level_2");
  const pin = find("postal_code");
  const addressLine = (street.length ? street.join(", ") : (raw.shortFormattedAddress ?? raw.formattedAddress ?? "")).slice(0, 200) || null;

  return {
    placeId: raw.id,
    name: (raw.displayName?.text ?? "").slice(0, 80),
    category: mapCategory(raw.primaryType, raw.types ?? []),
    categoryLabel: raw.primaryTypeDisplayName?.text ?? null,
    addressLine,
    city: city?.slice(0, 80) ?? null,
    state: find("administrative_area_level_1")?.slice(0, 80) ?? null,
    pincode: pin && /^\d{6}$/.test(pin) ? pin : null,
    phone: toIndianMobile(raw.nationalPhoneNumber),
    phoneDisplay: raw.nationalPhoneNumber ?? null,
    website: raw.websiteUri ?? null,
    latitude: raw.location?.latitude ?? null,
    longitude: raw.location?.longitude ?? null,
    googleMapsUri: raw.googleMapsUri ?? null,
    reviewUrl: googleReviewUrl(raw.id),
    rating: raw.rating ?? null,
    userRatingCount: raw.userRatingCount ?? null,
  };
}

export const googleReviewUrl = (placeId: string) => `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

export function toIndianMobile(phone: string | undefined | null) {
  if (!phone) return null;
  // Google groups mobiles as "098765 43210" and landlines by STD code ("079 2656 1234"), so a
  // spaced number that doesn't follow the 5+5 mobile grouping is a landline even if its digits look mobile.
  const t = phone.trim();
  if (/\s/.test(t) && !/^(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}$/.test(t)) return null;
  const digits = phone.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const CATEGORY_TYPES: [BusinessCategory, string[]][] = [
  ["juice_shop", ["juice_shop"]],
  ["cafe", ["cafe", "coffee_shop", "tea_house", "cafeteria", "internet_cafe"]],
  ["bakery", ["bakery"]],
  ["sweet_shop", ["dessert_shop", "candy_store", "confectionery", "ice_cream_shop", "chocolate_shop", "dessert_restaurant"]],
  ["salon", ["beauty_salon", "hair_salon", "hair_care", "barber_shop", "nail_salon", "spa", "beautician", "makeup_artist"]],
  ["gym", ["gym", "fitness_center", "yoga_studio", "sports_club"]],
  ["restaurant", ["restaurant", "meal_takeaway", "meal_delivery", "food_court", "diner", "bar", "pub"]],
];

export function mapCategory(primaryType: string | undefined, types: string[]): BusinessCategory {
  const ordered = [...(primaryType ? [primaryType] : []), ...types];
  for (const t of ordered) {
    for (const [category, list] of CATEGORY_TYPES) {
      if (list.includes(t) || (category === "restaurant" && t.endsWith("_restaurant"))) return category;
    }
    if (t.includes("sweet")) return "sweet_shop";
    if (t.endsWith("_store") || t === "store" || t === "supermarket" || t === "shopping_mall" || t === "market") return "retail";
  }
  return ordered.includes("point_of_interest") || ordered.includes("establishment") ? "services" : "other";
}
