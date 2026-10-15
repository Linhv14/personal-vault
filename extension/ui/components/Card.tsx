import type { ComponentChildren } from "preact";

export function Card({
  children,
  className = "",
}: {
  children: ComponentChildren;
  className?: string;
}) {
  return <div className={`card ${className}`.trim()}>{children}</div>;
}
