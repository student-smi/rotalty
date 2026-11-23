import { ApiError } from "./api";
import type { ReviewLanguage } from "../../shared/domain";

/** Like `api()` but allows extra headers (needed for the Turnstile `x-captcha-response` header). */
export async function reviewFetch<T>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
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

export interface ReviewSettings {
  enabled: boolean;
  profileName: string | null;
  reviewUrl: string | null;
  category: string | null;
  description: string | null;
  services: string | null;
  languages: ReviewLanguage[];
  showOnCard: boolean;
}

export type KeywordGroup = "product" | "service" | "ambience" | "location" | "other";
export interface ReviewKeyword {
  text: string;
  group: KeywordGroup;
  source?: "ai" | "owner";
}

export const KEYWORD_GROUP_LABELS: Record<KeywordGroup, string> = {
  product: "Products",
  service: "Service",
  ambience: "Place",
  location: "Location",
  other: "Other",
};

export interface ReviewAnalytics {
  days: number;
  visits: number;
  sessionsGenerated: number;
  sessionsFailed: number;
  generations: number;
  failures: number;
  draftsGenerated: number;
  redirectClicks: number;
  languages: Partial<Record<ReviewLanguage, number>>;
  ai: { calls: number; errors: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
  monthly: { used: number; limit: number | null; plan: string };
}

export interface PublicReviewInfo {
  business: { name: string; slug: string; category: string; logoUrl: string | null };
  profileName: string;
  languages: ReviewLanguage[];
  keywords: ReviewKeyword[];
}

export type DraftStyle = "short" | "friendly" | "detailed";

export interface DraftsResponse {
  sessionId: string;
  drafts: { style: DraftStyle; text: string }[];
  generationsLeft: number;
}
