import { expect, test } from "@playwright/test";
import { addLogin, itemOption, lockNow, newAccount, signUp, unlock } from "./popup.ts";
import { openPopup, useExtension } from "./extension.ts";

const harness = useExtension();
const account = newAccount("vault");
const login = {
  title: "Example login",
  url: "https://example.com",
  username: "alice@example.com",
  password: "correct horse battery staple",
};

test("sign up, add a login, lock and unlock", async () => {
  const popup = await openPopup(harness());
  await signUp(popup, account);
  await expect(popup.getByText("Nothing here yet. Press + to add one.")).toBeVisible();

  await addLogin(popup, login);

  await lockNow(popup);
  await unlock(popup, account);
  await expect(itemOption(popup, login.title, login.username)).toBeVisible();
});
