import type { BusinessCategory, Permission, StaffRole } from "../../shared/permissions";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }

  fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.details ?? []).map((d) => [d.path, d.message]));
  }
}

type Options = { method?: string; body?: unknown; form?: FormData };

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK", "No internet connection. Check your network and try again.");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: [] } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? "Something went wrong", err?.details);
  }
  return data as T;
}

export interface Membership {
  businessId: string;
  name: string;
  slug: string;
  category: BusinessCategory;
  logoUrl: string | null;
  businessStatus: "active" | "suspended";
  role: StaffRole;
  permissions: Permission[];
}

export interface Me {
  user: { id: string; name: string; email: string; role: "user" | "super_admin" };
  memberships: Membership[];
}

export interface Business {
  id: string;
  name: string;
  slug: string;
  category: BusinessCategory;
  description: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  googlePlaceId: string | null;
  whatsappNumber: string | null;
  instagramHandle: string | null;
  websiteUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  logoUrl: string | null;
  status: "active" | "suspended";
  suspendedReason: string | null;
  qrEnabled: boolean;
  nfcTagEnabled: boolean;
  nfcPhoneEnabled: boolean;
}

export interface BusinessResponse {
  business: Business;
  membership: { role: StaffRole; permissions: Permission[]; locationId: string | null };
}

export interface Location {
  id: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface StaffMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: StaffRole;
  status: "active" | "disabled";
  locationId: string | null;
  customPermissions: boolean;
  permissions: Permission[];
}

export interface Invitation {
  id: string;
  email: string;
  role: "manager" | "staff";
  locationId: string | null;
  expiresAt: string;
}
