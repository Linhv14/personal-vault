import { iconMarkup, type IconName } from "#ui/icons.js";

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: iconMarkup(name) }}
    />
  );
}
