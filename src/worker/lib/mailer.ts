export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Returns true only when the message was accepted by a real email provider. */
export async function sendEmail(env: Env, email: Email): Promise<boolean> {
  if (env.RESEND_API_KEY && env.EMAIL_FROM) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
    });
    if (!res.ok) {
      console.error("Email send failed", res.status, await res.text());
      return false;
    }
    return true;
  }
  if (env.APP_ENV !== "production") {
    console.log(`[dev-mail] to=${email.to} subject="${email.subject}"\n${email.text}`);
  } else {
    console.warn("Email provider not configured; message not sent:", email.subject);
  }
  return false;
}
