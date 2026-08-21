import type { AppEnv } from "../types";
import { fetchWithTimeout, readBoundedResponseText } from "./outbound-response";

const EMAIL_RESPONSE_MAX_BYTES = 16 * 1024;

type EmailInput = {
  to: string;
  subject: string;
  heading: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendEmail(env: AppEnv, input: EmailInput): Promise<void> {
  const brandUrl = `${env.APP_ORIGIN.replace(/\/$/, "")}/brand/clipquest-lockup-on-light.png`;
  const response = await fetchWithTimeout(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM,
        to: [input.to],
        subject: input.subject,
        text: `${input.heading}\n\n${input.message}\n\n${input.actionUrl}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#203329">
        <img src="${escapeHtml(brandUrl)}" alt="ClipQuest" width="260" style="display:block;width:260px;max-width:100%;height:auto;margin:0 0 28px" />
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2">${escapeHtml(input.heading)}</h1>
        <p style="margin:0 0 24px;color:#637368;font-size:16px;line-height:1.55">${escapeHtml(input.message)}</p>
        <p style="margin:0 0 24px"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#54c878;color:#102218;border-bottom:4px solid #2f9859;padding:12px 18px;border-radius:14px;font-weight:700;text-decoration:none">${escapeHtml(input.actionLabel)}</a></p>
        <p style="font-size:12px;color:#637368">If you did not request this, you can ignore this email.</p>
      </div>`,
      }),
    },
    15_000,
  );

  if (!response.ok) {
    const body = await readBoundedResponseText(
      response,
      EMAIL_RESPONSE_MAX_BYTES,
    ).catch(() => "Response body unavailable.");
    throw new Error(
      `Resend returned ${response.status}: ${body.slice(0, 300)}`,
    );
  }
}
