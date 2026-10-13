import TOKENS from "../../src/ui/tokens.css";

export const PASSKEY_STYLES = `${TOKENS}
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
[hidden] { display: none !important; }
.logo { display: inline-block; flex-shrink: 0; }
.logo svg { display: block; width: 100%; height: 100%; }
.backdrop {
  position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh; background: rgb(0 0 0 / 0.35);
}
.card {
  width: min(380px, calc(100vw - 32px)); padding: 20px; border-radius: 16px;
  border: 1px solid var(--border); background: var(--card); color: var(--text);
  box-shadow: 0 24px 64px rgb(0 0 0 / 0.3); font-size: 14px; line-height: 1.45;
}
.head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.heading { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.title { font-size: 15px; font-weight: 650; }
.subtitle { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.close {
  align-self: flex-start; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px;
  background: none; color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer;
}
.close:hover { background: var(--surface); color: var(--text); }
.body { display: flex; flex-direction: column; gap: 12px; }
.hint { margin: 0; color: var(--muted); }
.actions { display: flex; flex-direction: column; gap: 8px; }
.button {
  min-height: 40px; padding: 0 16px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--card); color: var(--text); font: inherit; font-weight: 600; cursor: pointer;
}
.button:hover { background: var(--surface-hover); }
.button.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
.button.primary:hover { background: var(--accent-hover); }
.button:disabled { opacity: 0.6; cursor: progress; }
.link {
  align-self: center; padding: 4px; border: none; background: none; color: var(--muted);
  font: inherit; font-size: 13px; cursor: pointer;
}
.link:hover { color: var(--text); text-decoration: underline; }
.accounts { display: flex; flex-direction: column; gap: 4px; }
.account {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: none;
  border-radius: 10px; background: var(--surface); color: inherit; text-align: left; font: inherit; cursor: pointer;
}
.account:hover { background: var(--surface-hover); }
.account:disabled { opacity: 0.6; cursor: progress; }
.account-text { display: flex; flex-direction: column; min-width: 0; }
.account-text strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-text small { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.avatar {
  display: grid; place-items: center; width: 32px; height: 32px; flex-shrink: 0; border-radius: 9px;
  background: var(--accent-soft); color: var(--accent); font-weight: 650;
}
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
`;
