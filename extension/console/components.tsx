import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { IconName } from "../../src/ui/icons.js";
import { Icon } from "../ui/components/Icon.js";
import { localeSignal, useT } from "../ui/i18n.js";

export interface Crumb {
  label: string;
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
  return (
    <header className="page-header">
      {crumbs.length > 0 && (
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((crumb, index) => (
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
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Dialog({
  title,
  description,
  onClose,
  onSubmit,
  submitLabel,
  danger = false,
  busy = false,
  children,
}: {
  title: string;
  description?: ComponentChildren;
  onClose: () => void;
  onSubmit: (form: HTMLFormElement) => void;
  submitLabel: string;
  danger?: boolean;
  busy?: boolean;
  children?: ComponentChildren;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(event.currentTarget);
        }}
      >
        <header className="dialog-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t("pin.cancel")}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {description && <div className="dialog-text">{description}</div>}
        {children && <div className="dialog-body">{children}</div>}
        <footer className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            {t("pin.cancel")}
          </button>
          <button
            type="submit"
            className={danger ? "btn danger" : "btn primary"}
            disabled={busy}
            autoFocus={!children}
          >
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

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function relativeTime(epochSeconds: number, locale: string): string {
  const delta = epochSeconds - Math.floor(Date.now() / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(delta) >= seconds) return format.format(Math.round(delta / seconds), unit);
  }
  return format.format(0, "minute");
}

export function When({ at }: { at: number }) {
  const locale = localeSignal.value;
  return (
    <time
      dateTime={new Date(at * 1000).toISOString()}
      title={new Date(at * 1000).toLocaleString(locale)}
    >
      {relativeTime(at, locale)}
    </time>
  );
}

export function Menu({ label, children }: { label: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
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
