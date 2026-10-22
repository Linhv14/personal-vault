import type { ComponentChildren } from "preact";
import { Logo, Wordmark } from "#ext/ui/components/Logo.js";
import { useT } from "#ext/ui/i18n.js";

export function AuthLayout({ id, children }: { id: string; children: ComponentChildren }) {
  const t = useT();
  return (
    <section id={id} className="screen auth">
      <aside className="auth-brand">
        <Logo size={44} animated />
        <Wordmark />
        <p className="tagline">{t("setup.tagline")}</p>
      </aside>
      <div className="auth-main">{children}</div>
    </section>
  );
}
