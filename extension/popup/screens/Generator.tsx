import { useMemo, useState } from "preact/hooks";
import {
  generatePassphrase,
  generatePassword,
  generatePin,
  rateStrength,
  type GeneratedSecret,
} from "../../../src/core/generator.js";
import { describeError, type MessageKey } from "../../../src/i18n/index.js";
import { useT } from "../../ui/i18n.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { copy, showList } from "../state.js";
import { formatEntropy } from "../strength.js";

type Mode = "password" | "passphrase" | "pin";

interface Options {
  length: number;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  words: number;
  capitalize: boolean;
  appendDigit: boolean;
  pin: number;
}

const DEFAULTS: Options = {
  length: 20,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  words: 8,
  capitalize: false,
  appendDigit: false,
  pin: 6,
};

function generate(mode: Mode, options: Options): GeneratedSecret {
  if (mode === "password") {
    return generatePassword({
      length: options.length,
      uppercase: options.uppercase,
      digits: options.digits,
      symbols: options.symbols,
      excludeAmbiguous: options.excludeAmbiguous,
    });
  }
  if (mode === "passphrase") {
    return generatePassphrase({
      words: options.words,
      capitalize: options.capitalize,
      appendDigit: options.appendDigit,
    });
  }
  return generatePin(options.pin);
}

export function Generator() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("password");
  const [options, setOptions] = useState(DEFAULTS);
  const [round, setRound] = useState(0);

  const result = useMemo((): GeneratedSecret | Error => {
    try {
      return generate(mode, options);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [mode, options, round]);

  const set = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOptions({ ...options, [key]: value });

  const range = (key: "length" | "words" | "pin", label: MessageKey, min: number, max: number) => (
    <label className="range">
      <span>{t(label)}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={options[key]}
        onInput={(event) => set(key, Number((event.currentTarget as HTMLInputElement).value))}
      />
      <output>{options[key]}</output>
    </label>
  );

  const check = (
    key: "uppercase" | "digits" | "symbols" | "excludeAmbiguous" | "capitalize" | "appendDigit",
    label: MessageKey,
  ) => (
    <label className="check">
      <span>{t(label)}</span>
      <input
        type="checkbox"
        checked={options[key]}
        onChange={(event) => set(key, (event.currentTarget as HTMLInputElement).checked)}
      />
    </label>
  );

  const failed = result instanceof Error;
  const strength = failed ? null : rateStrength(result.entropyBits);

  return (
    <section id="screen-generator" className="screen">
      <header className="title-bar">
        <IconButton icon="back" label={t("common.back")} onClick={showList} />
        <h1>{t("gen.title")}</h1>
      </header>
      <div className="gen-output">
        <code id="gen-value">{failed ? "—" : result.value}</code>
        <div className="gen-footer">
          <span className="meter">
            <span
              data-strength={strength ?? undefined}
              style={{
                width: failed ? "0%" : `${Math.min(100, (result.entropyBits / 128) * 100)}%`,
              }}
            />
          </span>
          <span id="gen-entropy" title={failed ? undefined : formatEntropy(result, t)}>
            {failed ? describeError(result, t) : t(`strength.${strength}` as MessageKey)}
          </span>
          <IconButton
            icon="refresh"
            label={t("gen.regenerate")}
            onClick={() => setRound(round + 1)}
          />
          <IconButton
            icon="copy"
            label={t("common.copy")}
            onClick={() => {
              if (!failed) void copy(result.value, t("common.password").toLowerCase());
            }}
          />
        </div>
      </div>
      <div className="segmented">
        {(
          [
            ["password", "gen.mode_random"],
            ["passphrase", "gen.mode_passphrase"],
            ["pin", "gen.mode_pin"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={mode === value ? "tab active" : "tab"}
            onClick={() => setMode(value)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {mode === "password" && (
        <div className="options">
          {range("length", "gen.length", 8, 64)}
          {check("uppercase", "gen.uppercase")}
          {check("digits", "gen.digits")}
          {check("symbols", "gen.symbols")}
          {check("excludeAmbiguous", "gen.exclude_ambiguous")}
        </div>
      )}
      {mode === "passphrase" && (
        <div className="options">
          {range("words", "gen.words", 4, 12)}
          {check("capitalize", "gen.capitalize")}
          {check("appendDigit", "gen.append_digit")}
        </div>
      )}
      {mode === "pin" && <div className="options">{range("pin", "gen.pin_digits", 4, 12)}</div>}
    </section>
  );
}
