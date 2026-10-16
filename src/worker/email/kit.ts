import { APP_NAME, WORDMARK } from "../../core/brand.js";
import { EMAIL_LOGO_PNG_BASE64 } from "../email-logo.js";
import type { InlineImage } from "../mailer.js";
import { COLORS, FONT, MONO } from "./theme.js";

export type EmailLocale = "en" | "vi";

export interface EmailContext {
  locale: EmailLocale;
  siteUrl: string;
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
  | { kind: "details"; rows: [label: string, value: string][] }
  | { kind: "steps"; title?: string; items: string[] }
  | { kind: "divider" };

export interface EmailSpec {
  subject: string;
  preheader: string;
  heading: string;
  blocks: Block[];
}

const LOGO: InlineImage = {
  contentId: "trust1-vault-logo",
  filename: "trust1-vault.png",
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
  small: `margin:0;font:400 13px/1.6 ${FONT};color:${COLORS.muted}`,
};

function blockHtml(block: Block): string {
  switch (block.kind) {
    case "text":
      return `<p style="${TEXT_STYLE[block.tone ?? "body"]}">${escape(block.text)}</p>`;
    case "code":
      return `<div style="margin:8px 0 24px;padding:18px 12px;border-radius:12px;background:${COLORS.soft};text-align:center;font:700 34px/1 ${MONO};letter-spacing:10px;color:${COLORS.accent}">${escape(block.code)}</div>`;
    case "button":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:${COLORS.accent}"><a href="${escape(block.href)}" style="display:inline-block;padding:13px 22px;font:650 15px/1 ${FONT};color:${COLORS.accentText};text-decoration:none;border-radius:10px">${escape(block.label)}</a></td></tr></table>`;
    case "details":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;border-radius:12px;background:${COLORS.panel}">${block.rows
        .map(
          ([label, value], index) =>
            `<tr><td style="padding:${index === 0 ? "14px" : "6px"} 16px ${index === block.rows.length - 1 ? "14px" : "6px"};width:38%;font:400 13px/1.5 ${FONT};color:${COLORS.muted};vertical-align:top">${escape(label)}</td><td style="padding:${index === 0 ? "14px" : "6px"} 16px ${index === block.rows.length - 1 ? "14px" : "6px"} 0;font:600 14px/1.5 ${FONT};color:${COLORS.text}">${escape(value)}</td></tr>`,
        )
        .join("")}</table>`;
    case "steps":
      return `${block.title ? `<p style="margin:0 0 10px;font:650 14px/1.5 ${FONT};color:${COLORS.text}">${escape(block.title)}</p>` : ""}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">${block.items
        .map(
          (item, index) =>
            `<tr><td style="padding:0 10px 8px 0;vertical-align:top"><span style="display:inline-block;width:22px;height:22px;border-radius:11px;background:${COLORS.soft};color:${COLORS.accent};font:700 12px/22px ${FONT};text-align:center">${index + 1}</span></td><td style="padding:2px 0 8px;font:400 14px/1.5 ${FONT};color:${COLORS.text}">${escape(item)}</td></tr>`,
        )
        .join("")}</table>`;
    case "divider":
      return `<div style="height:1px;margin:4px 0 20px;background:${COLORS.border}"></div>`;
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
    case "details":
      return block.rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    case "steps":
      return [block.title, ...block.items.map((item, index) => `${index + 1}. ${item}`)]
        .filter(Boolean)
        .join("\n");
    case "divider":
      return "—";
  }
}

function layout(context: EmailContext, spec: EmailSpec): string {
  const privacy = FOOTER[context.locale].privacy;
  const privacyUrl = `${context.siteUrl}/privacy`;
  const wordmark = `${escape(WORDMARK.lead)}<span style="color:${COLORS.accent}">${escape(WORDMARK.accent)}</span> <span style="color:${COLORS.muted};font-weight:600">${escape(WORDMARK.product)}</span>`;
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
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
<tr><td style="padding:0 4px 20px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-right:10px;vertical-align:middle"><img src="cid:${LOGO.contentId}" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px"></td><td style="vertical-align:middle;font:750 22px/1 ${FONT};letter-spacing:-0.4px;color:${COLORS.text}">${wordmark}</td></tr></table></td></tr>
<tr><td style="padding:32px 28px;background:${COLORS.card};border:1px solid ${COLORS.border};border-radius:16px">
<h1 style="margin:0 0 12px;font:650 22px/1.3 ${FONT};color:${COLORS.text}">${escape(spec.heading)}</h1>
${spec.blocks.map(blockHtml).join("\n")}
</td></tr>
<tr><td style="padding:24px 4px 0;font:400 12px/1.6 ${FONT};color:${COLORS.muted}">© ${new Date().getUTCFullYear()} ${escape(APP_NAME)} &nbsp;·&nbsp; <a href="${escape(context.siteUrl)}" style="color:${COLORS.muted}">${escape(siteHost(context.siteUrl))}</a> &nbsp;·&nbsp; <a href="${escape(privacyUrl)}" style="color:${COLORS.muted}">${escape(privacy)}</a></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderEmail(context: EmailContext, spec: EmailSpec): RenderedEmail {
  const footer = [
    "—",
    `© ${new Date().getUTCFullYear()} ${APP_NAME} · ${siteHost(context.siteUrl)}`,
    `${FOOTER[context.locale].privacy}: ${context.siteUrl}/privacy`,
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
