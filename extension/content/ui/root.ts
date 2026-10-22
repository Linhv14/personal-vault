import { logo } from "../../../src/ui/logo.js";
import { CONTENT_STYLES } from "../styles.js";

export const host = document.createElement("div");
host.style.cssText =
  "all: initial !important; position: absolute !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important;";
export const shadow = host.attachShadow({ mode: "closed" });
const style = document.createElement("style");
style.textContent = CONTENT_STYLES;
export const trigger = document.createElement("button");
trigger.className = "trigger";
trigger.type = "button";
trigger.append(logo(24));
trigger.hidden = true;
export const menu = document.createElement("div");
menu.className = "menu";
menu.hidden = true;
export const banner = document.createElement("div");
banner.className = "banner";
banner.hidden = true;
export const chip = document.createElement("div");
chip.className = "chip";
chip.hidden = true;
shadow.append(style, trigger, menu, banner, chip);
