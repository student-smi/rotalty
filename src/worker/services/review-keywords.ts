import { asc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { reviewKeywords } from "../db/schema";
import type { BusinessCategory } from "../../shared/permissions";
import type { KeywordGroup } from "./review-ai";

export async function listKeywords(db: DB, businessId: string) {
  return db
    .select({ id: reviewKeywords.id, text: reviewKeywords.text, group: reviewKeywords.group, source: reviewKeywords.source })
    .from(reviewKeywords)
    .where(eq(reviewKeywords.businessId, businessId))
    .orderBy(asc(reviewKeywords.sortOrder))
    .all();
}

type K = [string, KeywordGroup];

const COMMON: K[] = [
  ["friendly staff", "service"],
  ["quick service", "service"],
  ["clean place", "ambience"],
  ["value for money", "other"],
];

const BY_CATEGORY: Record<BusinessCategory, K[]> = {
  cafe: [["coffee", "product"], ["masala chai", "product"], ["snacks", "product"], ["cozy seating", "ambience"], ["good music", "ambience"]],
  restaurant: [["tasty food", "product"], ["fresh ingredients", "product"], ["good portions", "product"], ["family seating", "ambience"], ["hygienic kitchen", "ambience"]],
  juice_shop: [["fresh juice", "product"], ["seasonal fruits", "product"], ["milkshakes", "product"], ["no added sugar option", "product"], ["hygienic", "ambience"]],
  salon: [["haircut", "product"], ["hair spa", "product"], ["facial", "product"], ["skilled stylist", "service"], ["hygienic tools", "ambience"]],
  bakery: [["fresh cakes", "product"], ["cookies", "product"], ["fresh bread", "product"], ["custom cakes", "product"], ["eggless options", "product"]],
  sweet_shop: [["fresh sweets", "product"], ["kaju katli", "product"], ["namkeen", "product"], ["festival boxes", "product"], ["pure ghee", "product"]],
  gym: [["good equipment", "ambience"], ["helpful trainers", "service"], ["clean changing rooms", "ambience"], ["flexible timings", "service"], ["personal training", "product"]],
  retail: [["good variety", "product"], ["genuine products", "product"], ["helpful staff", "service"], ["easy billing", "service"], ["well organised", "ambience"]],
  services: [["on-time service", "service"], ["professional work", "service"], ["clear pricing", "service"], ["good quality work", "product"], ["polite staff", "service"]],
  other: [["good quality", "product"], ["helpful staff", "service"], ["well maintained", "ambience"], ["easy to find", "location"], ["good experience", "other"]],
};

/** Ready-made keyword ideas when AI isn't available. */
export function templateKeywords(category: BusinessCategory, area?: string | null): { text: string; group: KeywordGroup }[] {
  const list = [...(BY_CATEGORY[category] ?? BY_CATEGORY.other), ...COMMON];
  if (area) list.push([`near ${area}`.slice(0, 30), "location"]);
  const seen = new Set<string>();
  return list.filter(([t]) => !seen.has(t) && seen.add(t)).map(([text, group]) => ({ text, group }));
}
