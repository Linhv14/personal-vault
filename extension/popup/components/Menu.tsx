import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { IconName } from "#ui/icons.js";
import { Icon } from "#ext/ui/components/Icon.js";

export function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return ref;
}

export interface MenuEntry {
  key: string;
  label: string;
  icon?: IconName;
  leading?: ComponentChildren;
  trailing?: string | number;
  checked?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

export function MenuList({
  entries,
  onClose,
  align = "left",
  id,
  className = "",
}: {
  entries: MenuEntry[];
  onClose: () => void;
  align?: "left" | "right";
  id?: string;
  className?: string;
}) {
  const ref = useDismiss(onClose);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')?.focus();
  }, []);
  return (
    <div className={`menu menu-${align} ${className}`.trim()} role="menu" id={id} ref={ref}>
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.key}
          role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={entry.checked}
          className={entry.danger ? "menu-item danger" : "menu-item"}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
            entry.onSelect();
          }}
        >
          {entry.leading ?? (entry.icon && <Icon name={entry.icon} />)}
          <span className="menu-label">{entry.label}</span>
          {entry.trailing !== undefined && <span className="menu-trailing">{entry.trailing}</span>}
          {entry.checked && <Icon name="check" className="menu-check" />}
        </button>
      ))}
    </div>
  );
}

export function Dropdown({
  label,
  entries,
  id,
  align = "left",
  title,
}: {
  label: ComponentChildren;
  entries: MenuEntry[];
  id?: string;
  align?: "left" | "right";
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dropdown">
      <button
        type="button"
        className="dropdown-button"
        id={id}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        {label}
        <Icon name="chevron" />
      </button>
      {open && <MenuList entries={entries} align={align} onClose={() => setOpen(false)} />}
    </div>
  );
}
