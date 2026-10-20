import { expect, test } from "@playwright/test";
import { extensionUrl, openPopup, useExtension } from "./extension.ts";
import { newAccount, signUp } from "./popup.ts";

const harness = useExtension();
const account = newAccount("recovery");

test("shows a new recovery code and copies it", async () => {
  const popup = await openPopup(harness());
  await signUp(popup, account);
  await popup.close();

  const page = await harness().context.newPage();
  await page.goto(extensionUrl(harness(), "console/console.html#/me/security"));
  await expect(page.getByText("You have no recovery code yet.")).toBeVisible();
  await page.getByRole("button", { name: "Create recovery code" }).click();
  await page.getByLabel("Current master password").fill(account.password);
  await page.getByRole("button", { name: "Create recovery code" }).click();

  await expect(page.getByText("Save this code now. 7key shows it only once.")).toBeVisible();
  const code = page.locator("#recovery-code");
  const shown = (await code.textContent())?.trim() ?? "";
  expect(shown.replace(/[^0-9A-Za-z]/g, "")).toHaveLength(32);

  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByText("Recovery code copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shown);

  await page.getByRole("button", { name: "I've saved it" }).click();
  await expect(code).toBeHidden();
  await expect(page.getByText(/^Created on /)).toBeVisible();
});
