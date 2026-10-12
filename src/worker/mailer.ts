import { APP_NAME } from "../core/brand.js";
import { fromBase64 } from "../core/bytes.js";

export interface InlineImage {
  contentId: string;
  filename: string;
  contentType: string;
  base64: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  inlineImages?: InlineImage[];
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
    attachments?: {
      content: ArrayBuffer;
      filename: string;
      type: string;
      disposition: "inline";
      contentId: string;
    }[];
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
          ...(message.inlineImages?.length && {
            attachments: message.inlineImages.map((image) => ({
              filename: image.filename,
              content: image.base64,
              content_type: image.contentType,
              content_id: image.contentId,
            })),
          }),
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
    async send({ inlineImages = [], ...message }) {
      await binding.send({
        ...message,
        from: { email: from, name: SENDER_NAME },
        ...(inlineImages.length && {
          attachments: inlineImages.map((image) => ({
            content: fromBase64(image.base64).buffer,
            filename: image.filename,
            type: image.contentType,
            disposition: "inline" as const,
            contentId: image.contentId,
          })),
        }),
      });
    },
  };
}
