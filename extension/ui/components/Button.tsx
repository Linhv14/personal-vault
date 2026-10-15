import type { ComponentChildren, JSX } from "preact";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ComponentChildren;
  variant?: "default" | "primary" | "danger";
}

export function Button({ children, variant = "default", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`button ${variant === "default" ? "" : variant} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
