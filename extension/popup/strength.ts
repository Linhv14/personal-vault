import { rateStrength, type GeneratedSecret } from "#core/generator.js";
import type { MessageKey, Translate } from "#i18n/index.js";

export function formatEntropy(result: GeneratedSecret, t: Translate): string {
  return t("gen.entropy", {
    bits: result.entropyBits,
    strength: t(`strength.${rateStrength(result.entropyBits)}` as MessageKey),
  });
}
