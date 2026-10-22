import type { ComponentChildren } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import type { IconName } from "../../src/ui/icons.js";
import type { OrgRole } from "../../src/core/org-model.js";
import { Badge } from "../ui/components/ConsoleKit.js";
import { Fingerprint } from "../ui/components/Fingerprint.js";
import { Icon } from "../ui/components/Icon.js";
import { useT } from "../ui/i18n.js";
import { dismissToast, pending$, toasts$, type ToastKind } from "../ui/store/feedback.js";
import { ConsoleContext, refreshing$ } from "./data.js";
import { href as routeHref, location$ } from "./router.js";
import { ROLE_LABEL } from "./labels.js";

export {
  ActionButton,
  Badge,
  Dialog,
  EmptyState,
  SearchInput,
  Spinner,
  When,
} from "../ui/components/ConsoleKit.js";

export function ProgressBar() {
  const active = pending$.value || refreshing$.value;
  return <div className={active ? "progress active" : "progress"} role="presentation" />;
}

const TOAST_ICON: Record<ToastKind, IconName> = {
  success: "check",
  error: "alert",
  info: "note",
};

export function Toaster() {
  const t = useT();
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts$.value.map((entry) => (
        <div
          className={`toast ${entry.kind}`}
          key={entry.id}
          role={entry.kind === "error" ? "alert" : undefined}
        >
          <Icon name={TOAST_ICON[entry.kind]} />
          <span>{entry.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label={t("console.dismiss")}
            onClick={() => dismissToast(entry.id)}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ width, height }: { width?: string; height?: string }) {
  return <span className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

export function SkeletonTable({ rows = 5, columns = 3 }: { rows?: number; columns?: number }) {
  return (
    <div className="skeleton-table" aria-busy="true">
      {Array.from({ length: rows }, (_, row) => (
        <div className="skeleton-row" key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton
              key={column}
              width={column === 0 ? `${40 + ((row * 17) % 30)}%` : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true">
      <header className="page-header">
        <Skeleton width="180px" height="26px" />
      </header>
      <section className="panel">
        <div className="toolbar">
          <Skeleton width="260px" height="32px" />
        </div>
        <SkeletonTable />
      </section>
    </div>
  );
}

export interface Crumb {
  label: ComponentChildren;
  href?: string;
}

export function PageHeader({
  crumbs = [],
  title,
  meta,
  actions,
}: {
  crumbs?: Crumb[];
  title: ComponentChildren;
  meta?: ComponentChildren;
  actions?: ComponentChildren;
}) {
  const data = useContext(ConsoleContext);
  const { page } = location$.value.route;
  const org = data && page !== "invite" && page !== "me" ? data.detail.org : null;
  const trail: Crumb[] = org
    ? [
        {
          label: (
            <span className="crumb-org">
              <span className="org-mark" aria-hidden="true">
                {[...org.name.trim()][0]?.toUpperCase() ?? "?"}
              </span>
              {org.name}
            </span>
          ),
          href: routeHref(org.id, { page: "projects" }),
        },
        ...crumbs,
      ]
    : crumbs;
  return (
    <header className="page-header">
      {trail.length > 0 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {trail.map((crumb, index) => (
            <span key={index}>
              {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : crumb.label}
              <Icon name="chevron" className="crumb-sep" />
            </span>
          ))}
        </nav>
      )}
      <div className="page-title-row">
        <div className="page-title">
          <h1>{title}</h1>
          {meta && <div className="page-meta">{meta}</div>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    </header>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ComponentChildren;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Avatar({ text, size = "md" }: { text: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`avatar ${size}`} aria-hidden="true">
      {[...text.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}

export function Menu({ label, children }: { label: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    addEventListener("pointerdown", close);
    return () => removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-list" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  danger = false,
  onSelect,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" role="menuitem" className={danger ? "danger" : ""} onClick={onSelect}>
      <Icon name={icon} />
      {label}
    </button>
  );
}

export function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  if (!Number.isFinite(limit)) {
    return (
      <div className="usage">
        <div className="usage-row">
          <span>{label}</span>
          <span className="usage-value">{used}</span>
        </div>
      </div>
    );
  }
  const ratio = Math.min(1, used / limit);
  return (
    <div className="usage">
      <div className="usage-row">
        <span>{label}</span>
        <span className="usage-value">
          {used} / {limit}
        </span>
      </div>
      <div className="usage-bar">
        <span style={{ width: `${ratio * 100}%` }} className={ratio >= 1 ? "full" : ""} />
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="console" aria-busy="true">
      <aside className="sidebar">
        <div className="side-skeleton">
          <Skeleton width="120px" height="20px" />
          <Skeleton height="40px" />
          {[70, 55, 62, 48].map((width) => (
            <Skeleton key={width} width={`${width}%`} height="14px" />
          ))}
        </div>
      </aside>
      <main className="main">
        <PageSkeleton />
      </main>
    </div>
  );
}

export function PanelHead({
  title,
  text,
  action,
}: {
  title: string;
  text?: ComponentChildren;
  action?: ComponentChildren;
}) {
  return (
    <header className="panel-head">
      <div>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
      </div>
      {action && <div className="panel-head-action">{action}</div>}
    </header>
  );
}

export function KeyCheck({ email, publicKey }: { email: string; publicKey: string | null }) {
  const t = useT();
  return (
    <div className="key-check">
      <span className="field-label">{t("console.key_of", { email })}</span>
      <Fingerprint publicKey={publicKey} large />
      <p className="field-hint">{t("console.verify_hint")}</p>
    </div>
  );
}

export function RoleBadge({ role }: { role: OrgRole }) {
  const t = useT();
  return <Badge tone={role === "owner" ? "accent" : "neutral"}>{t(ROLE_LABEL[role])}</Badge>;
}
