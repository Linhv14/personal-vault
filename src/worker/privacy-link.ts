import { privacyUrl } from "#core/privacy-url.js";
import { escape } from "./email/kit.js";
import type { Env } from "./types.js";

const PRIVACY_LINK = /<!-- privacy-link: ([\s\S]*?) -->/g;

export function configuredPrivacyUrl(env: Pick<Env, "PRIVACY_URL">): string | undefined {
  return privacyUrl(env.PRIVACY_URL);
}

export function fillPrivacyLink(html: string, url: string | undefined): string {
  return html.replace(PRIVACY_LINK, (_, template: string) =>
    url ? template.replaceAll("{{privacyUrl}}", escape(url)) : "",
  );
}
