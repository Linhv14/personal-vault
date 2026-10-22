import { formKind, isCodeField } from "../detect.js";
import { state } from "../state.js";
import { isStandalonePhone, openAddressMenu } from "./address.js";
import { openCardMenu } from "./card.js";
import { openCodeMenu } from "./code.js";
import { openLoginMenu } from "./login.js";

export async function openMenu({ onlyIfUseful }: { onlyIfUseful: boolean }): Promise<void> {
  if (!state.activeInput) {
    return;
  }
  const input = state.activeInput;
  if (isCodeField(input)) {
    return openCodeMenu(input, onlyIfUseful);
  }
  const kind = formKind(input);
  if (kind === "card") {
    return openCardMenu(input, onlyIfUseful);
  }
  if (kind === "address") {
    return openAddressMenu(input, onlyIfUseful);
  }
  if (kind === "profile") {
    return openAddressMenu(input, onlyIfUseful, true);
  }
  if (isStandalonePhone(input)) {
    return openAddressMenu(input, onlyIfUseful, true, true);
  }
  return openLoginMenu(input, onlyIfUseful);
}
