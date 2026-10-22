import { useEffect, useRef } from "preact/hooks";
import { useT } from "../i18n.js";

export interface CodeBoxesProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  label: string;
}

export function CodeBoxes({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled = false,
  autoFocus = false,
  label,
}: CodeBoxesProps) {
  const t = useT();
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (autoFocus && !disabled && value === "") {
      boxes.current[0]?.focus();
    }
  }, [autoFocus, disabled, value === ""]);

  const update = (next: string, focusAt: number) => {
    const digits = next.replace(/\D/g, "").slice(0, length);
    latest.current = digits;
    onChange(digits);
    boxes.current[Math.min(focusAt, length - 1)]?.focus();
    if (digits.length === length) {
      onComplete?.(digits);
    }
  };

  const typed = (index: number, event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const value = latest.current;
    const entered = input.value.replace(/\D/g, "");
    if (!entered) {
      input.value = value[index] ?? "";
      return;
    }
    const before = value.slice(0, index);
    const after = value.slice(index + entered.length);
    update(before + entered + after, index + entered.length);
  };

  const keyDown = (index: number, event: KeyboardEvent) => {
    const value = latest.current;
    if (event.key === "Backspace") {
      event.preventDefault();
      if (value[index] !== undefined) {
        update(value.slice(0, index) + value.slice(index + 1), index);
      } else if (index > 0) {
        update(value.slice(0, index - 1) + value.slice(index), index - 1);
      }
    } else if (event.key === "ArrowLeft" && index > 0) {
      boxes.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < length - 1) {
      boxes.current[index + 1]?.focus();
    }
  };

  const pasted = (index: number, event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text") ?? "";
    const digits = text.replace(/\D/g, "");
    if (!digits) {
      return;
    }
    event.preventDefault();
    const value = latest.current;
    const start = digits.length >= length ? 0 : index;
    const before = value.slice(0, start);
    update(before + digits, start + digits.length);
  };

  return (
    <div className="code-boxes" role="group" aria-label={label}>
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          className={value[index] !== undefined ? "filled" : undefined}
          value={value[index] ?? ""}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={length}
          disabled={disabled}
          aria-label={t("twofa.digit", { n: index + 1 })}
          onInput={(event) => typed(index, event)}
          onKeyDown={(event) => keyDown(index, event)}
          onPaste={(event) => pasted(index, event)}
          onFocus={(event) => event.currentTarget.select()}
        />
      ))}
    </div>
  );
}
