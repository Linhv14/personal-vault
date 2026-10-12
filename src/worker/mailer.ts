import { APP_NAME } from "../core/brand.js";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: OutgoingEmail): Promise<void>;
}

interface EmailBinding {
  send(message: {
    to: string;
    from: { email: string; name: string };
    subject: string;
    text: string;
    html: string;
  }): Promise<unknown>;
}

export interface MailerEnv {
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  EMAIL?: EmailBinding;
}

const SENDER_NAME = APP_NAME;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function createMailer(env: MailerEnv): Mailer | null {
  const from = env.EMAIL_FROM;
  if (!from) return null;
  if (env.RESEND_API_KEY) return resendMailer(env.RESEND_API_KEY, from);
  if (env.EMAIL) return cloudflareMailer(env.EMAIL, from);
  return null;
}

function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(message) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${SENDER_NAME} <${from}>`,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend rejected the email (${response.status}): ${await response.text()}`);
      }
    },
  };
}

function cloudflareMailer(binding: EmailBinding, from: string): Mailer {
  return {
    async send(message) {
      await binding.send({ ...message, from: { email: from, name: SENDER_NAME } });
    },
  };
}
