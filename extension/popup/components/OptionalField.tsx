import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "#ext/ui/components/Icon.js";

export function OptionalField({
  filled,
  label,
  children,
}: {
  filled: boolean;
  label: string;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(filled);
  if (open) {
    return <>{children}</>;
  }
  return (
    <button type="button" className="link add-row" onClick={() => setOpen(true)}>
      <Icon name="plus" />
      {label}
    </button>
  );
}
