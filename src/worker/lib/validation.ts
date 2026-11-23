import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { badRequest } from "./errors";

export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw badRequest(
        "Please check the highlighted fields",
        result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    }
  });
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullish();

export const indianPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"));

export const pincode = z.string().trim().regex(/^\d{6}$/, "Enter a valid 6-digit PIN code");

export const addressFields = {
  addressLine: optionalText(200),
  city: optionalText(80),
  state: optionalText(80),
  pincode: pincode.nullish().or(z.literal("").transform(() => null)),
};

export { optionalText };
