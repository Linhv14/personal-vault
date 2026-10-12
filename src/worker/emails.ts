import { APP_NAME } from "../core/brand.js";

export type EmailLocale = "en" | "vi";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface EmailContext {
  locale: EmailLocale;
  siteUrl: string;
}

const COLORS = {
  page: "#faf9f6",
  card: "#ffffff",
  border: "#e0dcd4",
  text: "#1c1b19",
  muted: "#6b675f",
  accent: "#0f766e",
  codeBackground: "#ecf8f6",
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";

const STRINGS = {
  en: {
    code: {
      subject: (code: string) => `${code} is your ${APP_NAME} verification code`,
      preheader: (code: string) => `Your code is ${code}. It expires in 15 minutes.`,
      heading: "Confirm your email",
      intro: `Enter this code in ${APP_NAME} to finish creating your vault.`,
      expiry: "The code expires in 15 minutes and works once.",
      ignore:
        "Didn't try to create a vault? Ignore this email. Nobody can use the code without access to your inbox.",
    },
    existing: {
      subject: `Your email already has a ${APP_NAME} account`,
      preheader: "Someone tried to sign up with your address. Your vault is safe.",
      heading: "You already have an account",
      intro: `Someone, possibly you, just tried to create a ${APP_NAME} vault with this email address. It already has one, so nothing new was created.`,
      next: `If it was you, open ${APP_NAME} and choose "Sign in to your vault".`,
      ignore:
        "If it wasn't you, ignore this email. Your vault is still locked with your master password, which only you know.",
    },
    footer: `An automatic message from ${APP_NAME}. Replies are not read.`,
    privacy: "Privacy",
  },
  vi: {
    code: {
      subject: (code: string) => `${code} là mã xác minh ${APP_NAME} của bạn`,
      preheader: (code: string) => `Mã của bạn là ${code}, hết hạn sau 15 phút.`,
      heading: "Xác minh email của bạn",
      intro: `Nhập mã này trong ${APP_NAME} để hoàn tất việc tạo vault.`,
      expiry: "Mã hết hạn sau 15 phút và chỉ dùng được một lần.",
      ignore:
        "Bạn không tạo vault? Hãy bỏ qua thư này. Không ai dùng được mã nếu không đọc được hộp thư của bạn.",
    },
    existing: {
      subject: `Email của bạn đã có tài khoản ${APP_NAME}`,
      preheader: "Có người thử đăng ký bằng email của bạn. Vault của bạn vẫn an toàn.",
      heading: "Email này đã có tài khoản",
      intro: `Ai đó, có thể là bạn, vừa thử tạo vault ${APP_NAME} bằng địa chỉ email này. Email đã có tài khoản nên không có gì được tạo thêm.`,
      next: `Nếu là bạn, hãy mở ${APP_NAME} và chọn "Đăng nhập vault có sẵn".`,
      ignore:
        "Nếu không phải bạn, cứ bỏ qua thư này. Vault của bạn vẫn được khoá bằng master password mà chỉ bạn biết.",
    },
    footer: `Thư tự động từ ${APP_NAME}. Thư trả lời sẽ không được đọc.`,
    privacy: "Quyền riêng tư",
  },
} as const;

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function paragraph(text: string, tone: "body" | "muted" | "small" = "body"): string {
  const style = {
    body: `margin:0 0 16px;font:400 15px/1.6 ${FONT};color:${COLORS.text}`,
    muted: `margin:0 0 16px;font:400 14px/1.6 ${FONT};color:${COLORS.muted}`,
    small: `margin:0;font:400 13px/1.6 ${FONT};color:${COLORS.muted}`,
  }[tone];
  return `<p style="${style}">${escape(text)}</p>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:8px 0 24px;padding:18px 12px;border-radius:12px;background:${COLORS.codeBackground};text-align:center;font:700 34px/1 ${MONO};letter-spacing:10px;color:${COLORS.accent}">${escape(code)}</div>`;
}

function layout(
  context: EmailContext,
  email: { subject: string; preheader: string; heading: string; body: string },
): string {
  const strings = STRINGS[context.locale];
  const privacyUrl = `${context.siteUrl}/privacy`;
  const wordmark = `<span style="color:${COLORS.accent}">${escape(APP_NAME.slice(0, 1))}</span>${escape(APP_NAME.slice(1))}`;
  return `<!doctype html>
<html lang="${context.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escape(email.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(email.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">
<tr><td style="padding:0 4px 20px;font:750 24px/1 ${FONT};letter-spacing:-0.5px;color:${COLORS.text}">${wordmark}</td></tr>
<tr><td style="padding:32px 28px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px">
<h1 style="margin:0 0 12px;font:650 22px/1.3 ${FONT};color:${COLORS.text}">${escape(email.heading)}</h1>
${email.body}
</td></tr>
<tr><td style="padding:20px 4px 0;font:400 12px/1.6 ${FONT};color:${COLORS.muted}">${escape(strings.footer)} · <a href="${escape(privacyUrl)}" style="color:${COLORS.muted}">${escape(strings.privacy)}</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function plainText(context: EmailContext, blocks: string[]): string {
  const strings = STRINGS[context.locale];
  return [...blocks, "—", strings.footer, `${strings.privacy}: ${context.siteUrl}/privacy`].join(
    "\n\n",
  );
}

export function verificationCodeEmail(context: EmailContext, code: string): RenderedEmail {
  const strings = STRINGS[context.locale].code;
  const subject = strings.subject(code);
  return {
    subject,
    text: plainText(context, [
      strings.heading,
      strings.intro,
      `    ${code}`,
      strings.expiry,
      strings.ignore,
    ]),
    html: layout(context, {
      subject,
      preheader: strings.preheader(code),
      heading: strings.heading,
      body:
        paragraph(strings.intro) +
        codeBlock(code) +
        paragraph(strings.expiry, "muted") +
        paragraph(strings.ignore, "small"),
    }),
  };
}

export function existingAccountEmail(context: EmailContext): RenderedEmail {
  const strings = STRINGS[context.locale].existing;
  return {
    subject: strings.subject,
    text: plainText(context, [strings.heading, strings.intro, strings.next, strings.ignore]),
    html: layout(context, {
      subject: strings.subject,
      preheader: strings.preheader,
      heading: strings.heading,
      body: paragraph(strings.intro) + paragraph(strings.next) + paragraph(strings.ignore, "small"),
    }),
  };
}
