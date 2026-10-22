import TOKENS from "#ui/tokens.css";

export const CONTENT_STYLES = `${TOKENS}
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
[hidden] { display: none !important; }
.logo { display: inline-block; flex-shrink: 0; }
.logo svg { display: block; width: 100%; height: 100%; }
.wordmark { font-weight: 750; letter-spacing: 0.01em; color: var(--text); }
.wordmark-accent { color: var(--accent); }
.icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }

.trigger, .menu, .banner { position: absolute; color: var(--text); font-size: 13px; line-height: 1.4; }
.banner { position: fixed; }

.trigger {
  display: grid; place-items: center; padding: 0; margin: 0; cursor: pointer;
  border: none; border-radius: 6px; background: none; box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
}
.trigger .logo { width: 100% !important; height: 100% !important; }
.trigger:hover { filter: brightness(1.1); }

.menu {
  width: 280px; max-height: 320px; overflow-y: auto; padding: 6px;
  border-radius: 12px; border: 1px solid var(--border); background: var(--card);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.2);
}
.heading { display: flex; align-items: center; gap: 6px; padding: 6px 8px 8px; font-size: 13px; }
.row {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px; margin: 0;
  border: none; border-radius: 8px; background: none; color: inherit; text-align: left; cursor: pointer; font: inherit;
}
.row:hover, .row:focus-visible { background: var(--surface); outline: none; }
.text { display: flex; flex-direction: column; min-width: 0; }
.text strong { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.text small { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.avatar, .badge {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  font-weight: 600; background: var(--surface); color: var(--accent);
}
.brand, .flag {
  display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0;
  background: var(--surface); color: var(--muted); font-size: 10px; font-weight: 700;
}
.brand svg, .flag svg { display: block; width: 20px; height: 14px; border-radius: 2px; }
.flag svg { box-shadow: 0 0 0 1px rgb(0 0 0 / 0.12); }
.brand { letter-spacing: 0.02em; font-style: italic; }
.brand-visa { background: #1a1f71; color: #fff; }
.brand-amex { background: #2e77bc; color: #fff; font-style: normal; }
.brand-discover { background: #ff6000; color: #fff; font-style: normal; }
.brand-jcb { background: #0b4ea2; color: #fff; font-style: normal; }
.brand-unionpay { background: #e21836; color: #fff; font-style: normal; }
.brand-diners { background: #0079be; color: #fff; font-style: normal; }
.note { margin: 0; padding: 8px; color: var(--muted); font-size: 12px; }

.banner {
  top: 16px; right: 16px; width: min(360px, calc(100vw - 32px)); display: grid;
  grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 14px 12px; padding: 16px;
  border-radius: 16px; border: 1px solid var(--border); background: var(--card);
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.22); font-size: 14px; line-height: 1.45;
  animation: enter 160ms ease-out;
}
@keyframes enter { from { opacity: 0; transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { .banner { animation: none; } }

.banner .text { gap: 1px; }
.banner .text strong { font-size: 15px; font-weight: 650; white-space: normal; overflow-wrap: anywhere; }
.banner .text small { font-size: 13px; white-space: normal; overflow-wrap: anywhere; }
.fields { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.field-box {
  display: flex; align-items: center; min-height: 36px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg); color: var(--text);
}
.field-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--focus-ring); }
.field-box input {
  flex: 1; min-width: 0; height: 34px; padding: 0 10px; border: none; outline: none; background: none;
  color: inherit; font: inherit; font-size: 14px;
}
.reveal {
  display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border: none; background: none;
  color: var(--muted); cursor: pointer;
}
.reveal:hover { color: var(--text); }
.actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; }
.actions button {
  min-height: 38px; padding: 0 16px; border-radius: var(--radius); border: 1px solid var(--border);
  cursor: pointer; font: inherit; font-weight: 600; background: var(--card); color: var(--text);
}
.actions button.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-text); }
.actions button.primary:hover { background: var(--accent-hover); }
.actions button:not(.primary):hover { background: var(--surface-hover); }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

.heading.warning {
  margin: -6px -6px 4px; padding: 10px 14px; border-radius: 12px 12px 0 0;
  background: var(--danger-soft); color: var(--danger);
}
.heading.warning strong { font-weight: 700; }
.heading.warning .icon { stroke-width: 2.2; }
.row.armed { background: var(--danger-soft); }
.row.armed .text small { color: var(--danger); font-weight: 600; }

.banner .text small.reused { color: var(--danger); font-weight: 600; }

.banner .check {
  display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 13px; color: var(--text); cursor: pointer;
}
.banner .check input { margin: 0; accent-color: var(--accent); }
.banner .link {
  align-self: flex-start; margin-top: 4px; padding: 0; border: none; background: none; cursor: pointer;
  font: inherit; font-size: 13px; color: var(--muted); text-align: left;
}
.banner .link:hover { color: var(--text); text-decoration: underline; }

.chip {
  position: absolute; display: flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px;
  background: var(--danger-solid); color: var(--danger-on); font-size: 12px; font-weight: 600; line-height: 1.3;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.2);
}
.chip .icon { width: 14px; height: 14px; stroke-width: 2.2; }
`;
