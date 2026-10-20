import { expect, test, type Page } from "@playwright/test";
import { SITE_URL } from "./env.ts";
import { openPopup, useExtension } from "./extension.ts";
import { addLogin, itemOption, newAccount, signUp } from "./popup.ts";
import { ClosedShadow } from "./shadow.ts";

const harness = useExtension();
const account = newAccount("autofill");
const saved = {
  title: "Local site",
  url: SITE_URL,
  username: "alice",
  password: "alice local password",
};

const LOGIN_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Local login</title></head>
  <body>
    <form id="login">
      <label>Username <input name="username" autocomplete="username" /></label>
      <label>Password <input name="password" type="password" autocomplete="current-password" /></label>
      <button type="submit">Sign in</button>
    </form>
    <p id="welcome" hidden>Welcome back</p>
    <script>
      document.getElementById("login").addEventListener("submit", (event) => {
        event.preventDefault();
        event.currentTarget.remove();
        document.getElementById("welcome").hidden = false;
      });
    </script>
  </body>
</html>`;

async function openLoginPage(): Promise<Page> {
  const page = await harness().context.newPage();
  await page.goto(`${SITE_URL}/login`);
  return page;
}

test.beforeAll(async () => {
  await harness().context.route(`${SITE_URL}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: LOGIN_PAGE }),
  );
  await expect
    .poll(() =>
      harness().serviceWorker.evaluate(async () =>
        (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id),
      ),
    )
    .toContain("personal-vault-autofill");
});

test("suggests a saved login and fills it", async () => {
  const popup = await openPopup(harness());
  await signUp(popup, account);
  await addLogin(popup, saved);

  const page = await openLoginPage();
  const shadow = new ClosedShadow(page);
  await page.getByLabel("Username").click();

  await expect.poll(() => shadow.visibleText("menu")).toContain(saved.title);
  await shadow.click("row", new RegExp(saved.title));

  await expect(page.getByLabel("Username")).toHaveValue(saved.username);
  await expect(page.getByLabel("Password")).toHaveValue(saved.password);
  await page.close();
});

test("offers to save a new login after sign in and stores it", async () => {
  const page = await openLoginPage();
  const shadow = new ClosedShadow(page);
  await page.getByLabel("Username").fill("bob");
  await page.getByLabel("Password").fill("bob brand new password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Welcome back")).toBeVisible();

  await expect.poll(() => shadow.visibleText("banner")).toContain("Save password for localhost?");
  await shadow.click("primary", "Save");
  await expect.poll(() => shadow.visibleText("banner")).toContain("Saved to 7key");
  await page.close();

  const popup = await openPopup(harness());
  await expect(itemOption(popup, "localhost", "bob")).toBeVisible();
});
