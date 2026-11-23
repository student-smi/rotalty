export const PERMISSIONS = [
  "business.manage",
  "locations.manage",
  "staff.manage",
  "loyalty.manage",
  "points.issue",
  "rewards.redeem",
  "customers.view",
  "customers.export",
  "reviews.manage",
  "campaigns.manage",
  "analytics.view",
  "billing.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const STAFF_ROLES = ["owner", "manager", "staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: [
    "locations.manage",
    "loyalty.manage",
    "points.issue",
    "rewards.redeem",
    "customers.view",
    "reviews.manage",
    "campaigns.manage",
    "analytics.view",
  ],
  staff: ["points.issue", "rewards.redeem", "customers.view"],
};

// Owner-only permissions can never be delegated, so a manager cannot escalate to owner-equivalent access.
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = ["billing.manage", "business.manage", "staff.manage"];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "business.manage": "Edit business profile",
  "locations.manage": "Manage locations",
  "staff.manage": "Manage staff",
  "loyalty.manage": "Manage loyalty programs",
  "points.issue": "Issue loyalty points",
  "rewards.redeem": "Redeem rewards",
  "customers.view": "View customers",
  "customers.export": "Export customers",
  "reviews.manage": "Manage review assistant",
  "campaigns.manage": "Manage campaigns",
  "analytics.view": "View analytics",
  "billing.manage": "Manage subscription & billing",
};

export function effectivePermissions(role: StaffRole, custom: Permission[] | null): Permission[] {
  if (role === "owner") return [...PERMISSIONS];
  const base = custom ?? DEFAULT_ROLE_PERMISSIONS[role];
  return base.filter((p) => !OWNER_ONLY_PERMISSIONS.includes(p));
}

export const BUSINESS_CATEGORIES = [
  "cafe",
  "restaurant",
  "juice_shop",
  "salon",
  "bakery",
  "sweet_shop",
  "gym",
  "retail",
  "services",
  "other",
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];
