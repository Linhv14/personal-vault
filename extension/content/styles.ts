import TOKENS from "../../src/ui/tokens.css";

export const CONTENT_STYLES = `${TOKENS}
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
[hidden] { display: none !important; }
.logo { display: inline-block; flex-shrink: 0; }
.logo svg { display: block; width: 100%; height: 100%; }
.wordmark { font-weight: 750; letter-spacing: -0.03em; color: var(--text); }
.wordmark-accent { color: var(--accent); }
.icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }

.trigger, .menu, .banner { position: fixed; color: var(--text); font-size: 13px; line-height: 1.4; }

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
.note { margin: 0; padding: 8px; color: var(--muted); font-size: 12px; }

.banner {
  top: 16px; right: 16px; width: 340px; display: flex; align-items: center; gap: 12px; padding: 12px 14px;
  border-radius: 12px; border: 1px solid var(--border); background: var(--card);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.2);
}

.banner .text { flex: 1; min-width: 0; }
.banner .text strong { white-space: normal; }
.actions { display: flex; gap: 6px; }
.actions button {
  padding: 6px 10px; border-radius: 8px; border: none; cursor: pointer; font: inherit; font-size: 12.5px;
  background: var(--surface); color: var(--text);
}
.actions button.primary { background: var(--accent); color: var(--accent-text); font-weight: 600; }
.actions button.primary:hover { background: var(--accent-hover); }
.actions button:not(.primary):hover { background: var(--surface-hover); }
button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
`;
