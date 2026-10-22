import { isEmailInput } from "../detect.js";
import { send } from "../send.js";
import { t } from "../state.js";
import { setValue } from "../track.js";
import { badge, closeMenu, menuRow } from "../ui/menu.js";

export async function aliasRows(input: HTMLInputElement): Promise<HTMLElement[]> {
  if (!isEmailInput(input)) {
    return [];
  }
  const response = await send({ type: "autofill:aliases" });
  if (!response.ok || !("aliases" in response)) {
    return [];
  }
  return response.aliases.map((alias) =>
    menuRow(t("autofill.alias", { site: response.site }), alias, badge("mail"), () => {
      closeMenu();
      setValue(input, alias);
    }),
  );
}
