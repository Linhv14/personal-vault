import { expect, test, type Page } from "@playwright/test";
import { extensionUrl, openPopup, useExtension } from "./extension.ts";
import { newAccount, signUp } from "./popup.ts";

const harness = useExtension();
const account = newAccount("console");
const projectName = "Payments API";
let page: Page;

async function addSecret(name: string, value: string): Promise<void> {
  await page.getByRole("button", { name: "Add secret" }).first().click();
  const dialog = dialogTitled("Add secret");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  for (const env of ["Development", "Staging", "Production"]) {
    await dialog.getByRole("textbox", { name: `${env} Value` }).fill(`${value}-${env}`);
  }
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
}

function dialogTitled(title: string) {
  return page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: title }) });
}

function secretRow(name: string) {
  return page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
}

test("create an organization, a team and a project", async () => {
  const popup = await openPopup(harness());
  await signUp(popup, account);
  await popup.close();

  page = await harness().context.newPage();
  await page.goto(extensionUrl(harness(), "console/console.html"));
  await page.getByLabel("Company name").fill("Acme");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Teams", exact: true }).click();
  await page.getByRole("button", { name: "Create team" }).first().click();
  await page.getByLabel("Team name").fill("Backend");
  await dialogTitled("Create team").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Backend", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "Create project" }).first().click();
  const dialog = dialogTitled("Create project");
  await dialog.getByLabel("Project name").fill(projectName);
  await expect(dialog.getByLabel("Team")).toHaveValue(/.+/);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: projectName, level: 1 })).toBeVisible();
});

test("add a secret, edit it and open its history", async () => {
  await addSecret("DATABASE_URL", "postgres://first");
  await addSecret("API_KEY", "key");

  await page.getByRole("tab", { name: /^Development/ }).click();
  const row = secretRow("DATABASE_URL");
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Edit" }).click();
  const editor = row.getByRole("textbox", { name: "DATABASE_URL" });
  await expect(editor).toHaveValue("postgres://first-Development");
  await editor.fill("postgres://second");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(editor).toBeHidden();

  await row.getByTitle("Show").click();
  await expect(row.getByText("postgres://second")).toBeVisible();

  await row.getByRole("button", { name: "History" }).click();
  const history = dialogTitled("Earlier values of DATABASE_URL");
  await expect(history.getByRole("button", { name: "Restore" })).toHaveCount(1);
  await history.getByRole("button", { name: "Close" }).last().click();
  await expect(history).toBeHidden();
});

test("delete a secret through the destructive dialog", async () => {
  const row = secretRow("API_KEY");
  await row.getByRole("button", { name: "Delete" }).click();
  const dialog = dialogTitled("Delete secret");
  await expect(dialog).toContainText("Delete API_KEY from Development?");
  await expect(dialog.getByRole("button", { name: "Cancel" }).last()).toBeFocused();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  await expect(secretRow("DATABASE_URL")).toBeVisible();
});

test("protect an environment and show the lock", async () => {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Protect Development" }).click();
  await expect(page.getByText("Admins only")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: /^Development/ }).getByTitle(/^Protected:/),
  ).toBeVisible();
});

test("delete the project after typing its name", async () => {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete project" }).click();
  const dialog = dialogTitled("Delete project");
  const confirm = dialog.getByRole("button", { name: "Delete project" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill(projectName.slice(0, -1));
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox").fill(projectName);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: projectName })).toHaveCount(0);
});
