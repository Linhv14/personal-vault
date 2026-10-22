import type { JSX } from "preact";
import type { IconName } from "#ui/icons.js";
import { Icon } from "./Icon.js";

export function IconButton({
  icon,
  label,
  onClick,
  className = "",
  ...rest
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  className?: string;
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "icon">) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`.trim()}
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
