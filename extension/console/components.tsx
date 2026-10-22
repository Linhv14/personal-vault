import type { ComponentChildren, JSX } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import type { IconName } from "../../src/ui/icons.js";
import type { OrgRole } from "../../src/core/org-model.js";
import { Fingerprint } from "../ui/components/Fingerprint.js";
import { Icon } from "../ui/components/Icon.js";
import { formatRelative } from "../ui/format.js";
import { localeSignal, useT } from "../ui/i18n.js";
import {
  ConsoleContext,
  dismissToast,
  failure$,
  pending$,
  refreshing$,
  toasts$,
  type ToastKind,
} from "./data.js";
import { href as routeHref, location$ } from "./router.js";
import { ROLE_LABEL } from "./labels.js";

export function Spinner({ size = "sm" }: { size?: "sm" | "md" }) {
  return <span className={`spin ${size}`} aria-hidden="true" />;
}

export function ActionButton({
  icon,
  onClick,
  className = "btn",
  disabled = false,
  children,
  ...rest
}: {
  icon?: IconName;
  onClick: () => Promise<unknown> | void;
  className?: string;
  disabled?: boolean;
  children?: ComponentChildren;
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "icon" | "disabled">) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={async (event) => {
        event.stopPropagation();
        if (busy || pending$.value) {
          return;
        }
        setBusy(true);
        try {
          await onClick();
        } finally {
          if (mounted.current) {
            setBusy(false);
          }
        }
      }}
      {...rest}
    >
      {busy ? <Spinner /> : icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

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

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: ComponentChildren;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <div className="empty-body">
        <strong>{title}</strong>
        {text && <p>{text}</p>}
      </div>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

function emphasize(text: string, words: string[]): ComponentChildren {
  const wanted = words.filter(Boolean);
  if (wanted.length === 0) {
    return text;
  }
  const pattern = new RegExp(
    `(${wanted.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  );
  return text
    .split(pattern)
    .map((part, index) => (wanted.includes(part) ? <strong key={index}>{part}</strong> : part));
}

export function Dialog({
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  danger = false,
  busy = false,
  hideCancel = false,
  highlight = [],
  children,
}: {
  title: string;
  description?: ComponentChildren;
  highlight?: string[];
  onClose: () => void;
  onSubmit: (form: HTMLFormElement) => void;
  submitLabel: string;
  danger?: boolean;
  busy?: boolean;
  hideCancel?: boolean;
  children?: ComponentChildren;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const working = pending$.value;
  const close = () => {
    if (!pending$.value) {
      onClose();
    }
  };
  useEffect(() => {
    failure$.value = null;
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }, []);
  return (
    <dialog
      ref={ref}
      className={danger ? "dialog danger" : "dialog"}
      aria-busy={working || undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          close();
        }
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending$.value) {
            return;
          }
          onSubmit(event.currentTarget);
        }}
      >
        <header className="dialog-head">
          {danger && (
            <span className="dialog-mark" aria-hidden="true">
              <Icon name="alert" />
            </span>
          )}
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t("pin.cancel")}
            onClick={close}
            disabled={working}
          >
            <Icon name="close" />
          </button>
        </header>
        {description && (
          <div className="dialog-text">
            {typeof description === "string" ? emphasize(description, highlight) : description}
          </div>
        )}
        {children && <div className="dialog-body">{children}</div>}
        {failure$.value && (
          <p className="dialog-error" role="alert">
            {failure$.value}
          </p>
        )}
        <footer className="dialog-foot">
          {!hideCancel && (
            <button
              type="button"
              className="btn"
              onClick={close}
              disabled={working}
              autoFocus={danger && !children}
            >
              {t("pin.cancel")}
            </button>
          )}
          <button
            type="submit"
            className={danger ? "btn danger" : "btn primary"}
            disabled={busy || working}
            aria-busy={working || undefined}
            autoFocus={!danger && (!children || hideCancel)}
          >
            {working && <Spinner />}
            {submitLabel}
          </button>
        </footer>
      </form>
    </dialog>
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

export function SearchInput({
  value,
  onInput,
  placeholder,
}: {
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search">
      <Icon name="search" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
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

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "warn" | "danger" | "ok";
  children: ComponentChildren;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function When({ at }: { at: number }) {
  const locale = localeSignal.value;
  return (
    <time
      dateTime={new Date(at * 1000).toISOString()}
      title={new Date(at * 1000).toLocaleString(locale)}
    >
      {formatRelative(at, locale, { smallest: "minute" })}
    </time>
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
