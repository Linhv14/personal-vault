import { APP_NAME, WORDMARK } from "#core/brand.js";
import { EMAIL_LOGO_PNG_BASE64 } from "../email-logo.js";
import type { InlineImage } from "../mailer.js";
import { COLORS, FONT, MONO } from "./theme.js";

export type EmailLocale = "en" | "vi";

export interface EmailContext {
  locale: EmailLocale;
  siteUrl: string;
  privacyUrl?: string | undefined;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  inlineImages: InlineImage[];
}

export type Block =
  | { kind: "text"; text: string; tone?: "body" | "muted" | "small" }
  | { kind: "code"; code: string }
  | { kind: "button"; label: string; href: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "divider" };

export interface EmailSpec {
  subject: string;
  preheader: string;
  heading: string;
  blocks: Block[];
}

const LOGO: InlineImage = {
  contentId: "7key-logo",
  filename: "7key.png",
  contentType: "image/png",
  base64: EMAIL_LOGO_PNG_BASE64,
};

const FOOTER = {
  en: { privacy: "Privacy policy" },
  vi: { privacy: "Chính sách quyền riêng tư" },
} as const;

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function siteHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return siteUrl;
  }
}

const TEXT_STYLE = {
  body: `margin:0 0 16px;font:400 15px/1.6 ${FONT};color:${COLORS.text}`,
  muted: `margin:0 0 16px;font:400 14px/1.6 ${FONT};color:${COLORS.muted}`,
  small: `margin:0 0 12px;font:400 13px/1.6 ${FONT};color:${COLORS.muted}`,
};

function blockHtml(block: Block): string {
  switch (block.kind) {
    case "text":
      return `<p style="${TEXT_STYLE[block.tone ?? "body"]}">${escape(block.text)}</p>`;
    case "code":
      return `<p style="margin:4px 0 20px;padding:14px 18px;border-radius:6px;background:${COLORS.panel};font:600 28px/1 ${MONO};letter-spacing:6px;color:${COLORS.text}">${escape(block.code)}</p>`;
    case "button":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:6px;background:${COLORS.accent}"><a href="${escape(block.href)}" style="display:inline-block;padding:11px 18px;font:600 14px/1.2 ${FONT};color:${COLORS.accentText};text-decoration:none;border-radius:6px">${escape(block.label)}</a></td></tr></table>`;
    case "link":
      return `<p style="margin:0 0 4px;font:400 13px/1.6 ${FONT};color:${COLORS.muted}">${escape(block.label)}</p><p style="margin:0 0 16px;font:400 13px/1.5 ${MONO};word-break:break-all"><a href="${escape(block.href)}" style="color:${COLORS.accent};text-decoration:none">${escape(block.href)}</a></p>`;
    case "divider":
      return `<div style="height:1px;margin:20px 0 20px;background:${COLORS.border}"></div>`;
  }
}

function blockText(block: Block): string {
  switch (block.kind) {
    case "text":
      return block.text;
    case "code":
      return `    ${block.code}`;
    case "button":
      return `${block.label}: ${block.href}`;
    case "link":
      return `${block.label}\n${block.href}`;
    case "divider":
      return "—";
  }
}

function layout(context: EmailContext, spec: EmailSpec): string {
  const privacy = context.privacyUrl
    ? ` &nbsp;·&nbsp; <a href="${escape(context.privacyUrl)}" style="color:${COLORS.muted}">${escape(FOOTER[context.locale].privacy)}</a>`
    : "";
  const wordmark = `<span style="color:${COLORS.accent}">${escape(WORDMARK.accent)}</span>${escape(WORDMARK.rest)}`;
  return `<!doctype html>
<html lang="${context.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escape(spec.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(spec.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.page}">
<tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:32px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:8px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px"><tr><td style="padding-right:8px;vertical-align:middle"><img src="cid:${LOGO.contentId}" width="24" height="24" alt="" style="display:block;border:0;border-radius:6px"></td><td style="vertical-align:middle;font:700 16px/1 ${FONT};letter-spacing:-0.2px;color:${COLORS.text}">${wordmark}</td></tr></table>
<h1 style="margin:0 0 16px;font:600 20px/1.35 ${FONT};color:${COLORS.text}">${escape(spec.heading)}</h1>
${spec.blocks.map(blockHtml).join("\n")}
</td></tr>
<tr><td style="padding:20px 32px 0;font:400 12px/1.6 ${FONT};color:${COLORS.muted}">${escape(APP_NAME)} &nbsp;·&nbsp; <a href="${escape(context.siteUrl)}" style="color:${COLORS.muted}">${escape(siteHost(context.siteUrl))}</a>${privacy}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderEmail(context: EmailContext, spec: EmailSpec): RenderedEmail {
  const footer = [
    "—",
    `${APP_NAME} · ${siteHost(context.siteUrl)}`,
    ...(context.privacyUrl ? [`${FOOTER[context.locale].privacy}: ${context.privacyUrl}`] : []),
  ];
  return {
    subject: spec.subject,
    text: [spec.heading, ...spec.blocks.map(blockText), ...footer].join("\n\n"),
    html: layout(context, spec),
    inlineImages: [LOGO],
  };
}

export function formatDate(epochSeconds: number, locale: EmailLocale): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(epochSeconds * 1000));
}
