import { conditionalPasskeys } from "#ext/lib/passkey/conditional.js";
import type { PasskeyOption } from "#ext/lib/passkey/protocol.js";
import { closeMenu } from "../ui/menu.js";

export async function offeredPasskeys(input: HTMLInputElement): Promise<PasskeyOption[]> {
  const passkeys = conditionalPasskeys();
  if (!passkeys || input.type === "password") {
    return [];
  }
  return (await passkeys.list()).passkeys;
}

export async function usePasskey(passkey: PasskeyOption): Promise<void> {
  closeMenu();
  await conditionalPasskeys()?.use(passkey.credentialId);
}
