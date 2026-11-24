import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ basePath: "/api/auth" });

export { captchaHeaders, TURNSTILE_SITE_KEY } from "./captcha";
