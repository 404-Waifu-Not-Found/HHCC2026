import type { AppEnv } from "../types";

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
  const response = await fetch("https://api.resend.com/emails", {
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
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;color:#101c3b">
        <h1>${escapeHtml(input.heading)}</h1>
        <p>${escapeHtml(input.message)}</p>
        <p><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#b8f244;color:#101c3b;padding:12px 18px;border-radius:14px;font-weight:700;text-decoration:none">${escapeHtml(input.actionLabel)}</a></p>
        <p style="font-size:12px;color:#536079">If you did not request this, you can ignore this email.</p>
      </div>`,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend returned ${response.status}: ${body.slice(0, 300)}`);
  }
}

