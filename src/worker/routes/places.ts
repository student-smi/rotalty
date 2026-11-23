import { Hono } from "hono";
import { z } from "zod";
import { requireUser } from "../middleware/auth";
import { validate } from "../lib/validation";
import { autocomplete, PLACE_ID_RE, placeDetails, placesEnabled } from "../services/places";
import type { AppEnv } from "../types";

const session = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "Invalid session token");

/** Signed-in users only: lets owners find their shop on Google and autofill its details. */
export const placesRoutes = new Hono<AppEnv>()
  .get("/status", (c) => c.json({ enabled: placesEnabled(c.env) }))

  .get(
    "/autocomplete",
    requireUser,
    validate("query", z.object({ q: z.string().trim().min(2).max(100), session })),
    async (c) => {
      const { q, session: token } = c.req.valid("query");
      return c.json({ suggestions: await autocomplete(c.env, q, token) });
    },
  )

  .get(
    "/details/:placeId",
    requireUser,
    validate("param", z.object({ placeId: z.string().regex(PLACE_ID_RE, "Invalid place id") })),
    validate("query", z.object({ session: session.optional() })),
    async (c) => {
      const { placeId } = c.req.valid("param");
      return c.json({ place: await placeDetails(c.env, placeId, c.req.valid("query").session) });
    },
  );
