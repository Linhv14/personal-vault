import { useEffect, useRef, useState } from "preact/hooks";
import { generateTotp, secondsRemaining, type TotpConfig } from "../../../src/core/totp.js";
import { useT } from "../../ui/i18n.js";
import { copy, nowMs } from "../state.js";
import { CopyRow } from "./FieldRow.js";

function Ring({
  radius,
  size,
  ratio,
  urgent,
}: {
  radius: number;
  size: number;
  ratio: number;
  urgent: boolean;
}) {
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const last = useRef(ratio);
  const refill = ratio > last.current;
  last.current = ratio;
  return (
    <svg
      className={["ring", urgent && "urgent", refill && "refill"].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <circle className="track" cx={center} cy={center} r={radius} />
      <circle
        className="progress"
        cx={center}
        cy={center}
        r={radius}
        stroke-dasharray={circumference}
        stroke-dashoffset={circumference * (1 - ratio)}
      />
    </svg>
  );
}

function useTotp(config: TotpConfig): { code: string; remaining: number; period: number } {
  const period = config.period || 30;
  const [remaining, setRemaining] = useState(() => secondsRemaining(period, nowMs()));
  const [code, setCode] = useState("");

  useEffect(() => {
    let active = true;
    let lastCounter = -1;
    const tick = async () => {
      setRemaining(secondsRemaining(period, nowMs()));
      const counter = Math.floor(nowMs() / 1000 / period);
      if (counter === lastCounter) return;
      lastCounter = counter;
      try {
        const next = await generateTotp(config, nowMs());
        if (active) setCode(next);
      } catch {
        if (active) setCode("—");
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [config.secret, config.algorithm, config.digits, period]);

  return { code, remaining, period };
}

function LiveCode({
  totp,
  radius,
  size,
}: {
  totp: ReturnType<typeof useTotp>;
  radius: number;
  size: number;
}) {
  const ratio = totp.remaining / totp.period;
  return (
    <span className="totp-row" aria-hidden="true">
      <Ring radius={radius} size={size} ratio={ratio} urgent={totp.remaining <= 5} />
      <span className="totp-code">
        {totp.code ? totp.code.replace(/(\d{3})(?=\d)/, "$1 ") : "··· ···"}
      </span>
    </span>
  );
}

export function TotpRow({ config }: { config: TotpConfig }) {
  const t = useT();
  const totp = useTotp(config);
  return (
    <CopyRow
      icon="clock"
      label={t("common.totp")}
      onCopy={() => {
        if (totp.code) void copy(totp.code, t("common.totp"));
      }}
    >
      <LiveCode totp={totp} radius={8} size={20} />
    </CopyRow>
  );
}
