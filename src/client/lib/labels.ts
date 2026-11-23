import type { BusinessCategory, StaffRole } from "../../shared/permissions";

export const CATEGORY_LABELS: Record<BusinessCategory, string> = {
  cafe: "Cafe",
  restaurant: "Restaurant",
  juice_shop: "Juice shop",
  salon: "Salon / Barbershop",
  bakery: "Bakery",
  sweet_shop: "Sweet shop",
  gym: "Gym / Fitness studio",
  retail: "Retail store",
  services: "Local services",
  other: "Other",
};

export const ROLE_LABELS: Record<StaffRole, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };
