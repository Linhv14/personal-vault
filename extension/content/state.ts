import { createTranslator, type Translate } from "../../src/i18n/index.js";
import type { LookalikeMatch } from "../../src/core/lookalike.js";
import type { FilledFields } from "./forms/read.js";

export const state = {
  translate: createTranslator("en"),
  activeInput: null as HTMLInputElement | null,
  cardFrame: null as HTMLIFrameElement | null,
  filling: false,
  following: false,
  siteWarning: null as LookalikeMatch | null,
  lastCapture: { password: "", at: 0 },
  outcomeTimer: undefined as ReturnType<typeof setInterval> | undefined,
  lastFormCapture: { key: "", at: 0 },
  totpSeen: "",
  setupScans: 0,
  setupTimer: undefined as ReturnType<typeof setTimeout> | undefined,
};

export const filled: FilledFields = new WeakMap();

export const t: Translate = (...args) => state.translate(...args);
