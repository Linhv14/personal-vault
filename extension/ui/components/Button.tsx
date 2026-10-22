import type { ComponentChildren, JSX } from "preact";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ComponentChildren;
  variant?: "default" | "primary" | "danger";
}

export function Button({ children, variant = "default", className, ...props }: ButtonProps) {
  return (
    <button
      className={[
        "button",
        variant === "default" ? "" : variant,
        typeof className === "string" ? className : (className?.value ?? ""),
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
