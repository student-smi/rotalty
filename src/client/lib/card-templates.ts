import type { BusinessCategory } from "../../shared/permissions";
import type { StampIcon } from "./loyalty-api";

export interface CardTemplate {
  programName: string;
  stamps: number;
  reward: string;
  icon: StampIcon;
}

/** Sensible first offers per category; the owner can change everything. */
export const TEMPLATES: Record<BusinessCategory, CardTemplate> = {
  cafe: { programName: "Coffee lover card", stamps: 10, reward: "Free coffee", icon: "coffee" },
  restaurant: { programName: "Foodie card", stamps: 8, reward: "Free dessert", icon: "gift" },
  juice_shop: { programName: "Fresh juice card", stamps: 6, reward: "Free juice", icon: "drop" },
  salon: { programName: "Style card", stamps: 5, reward: "Free haircut", icon: "scissors" },
  bakery: { programName: "Sweet treats card", stamps: 8, reward: "Free pastry", icon: "cake" },
  sweet_shop: { programName: "Mithai card", stamps: 8, reward: "Free 250 g sweets", icon: "cake" },
  gym: { programName: "Fitness card", stamps: 12, reward: "1 free personal training session", icon: "dumbbell" },
  retail: { programName: "Shopper card", stamps: 5, reward: "₹100 off your next bill", icon: "bag" },
  services: { programName: "Loyal customer card", stamps: 5, reward: "₹100 off your next service", icon: "star" },
  other: { programName: "Loyalty card", stamps: 8, reward: "Free item", icon: "star" },
};
