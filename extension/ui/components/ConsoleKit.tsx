import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { IconName } from "#ui/icons.js";
import { formatRelative } from "../format.js";
import { localeSignal, useT } from "../i18n.js";
import { failure$, pending$ } from "../store/feedback.js";
import { Icon } from "./Icon.js";

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
