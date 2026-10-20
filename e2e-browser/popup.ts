import { expect, type Locator, type Page } from "@playwright/test";
import { API_URL, REGISTRATION_TOKEN } from "./env.ts";

export interface Account {
  email: string;
  password: string;
}

export function newAccount(label: string): Account {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { email: `${label}-${stamp}@example.com`, password: "browser e2e master password" };
}

export async function signUp(popup: Page, account: Account): Promise<void> {
  await popup.getByRole("button", { name: /Create a new vault/ }).click();
  const server = popup.getByLabel("Server");
  if (!(await server.isVisible())) {
    await popup.getByRole("button", { name: "Use your own server" }).click();
  }
  await server.fill(API_URL);
  await server.dispatchEvent("change");
  await popup.getByLabel("Email").fill(account.email);
  await popup.getByLabel("Registration code").fill(REGISTRATION_TOKEN);
  await popup.getByLabel("Master password", { exact: true }).fill(account.password);
  await popup.getByLabel("Confirm master password").fill(account.password);
  await popup.getByRole("button", { name: "Create vault" }).click();
  await expect(popup.locator("body")).toHaveAttribute("data-screen", "list", { timeout: 60_000 });
}

export async function unlock(popup: Page, account: Account): Promise<void> {
  await expect(popup.getByRole("heading", { name: "Unlock" })).toBeVisible();
  await popup.getByPlaceholder("Master password").fill(account.password);
  await popup.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(popup.locator("body")).toHaveAttribute("data-screen", "list", { timeout: 60_000 });
}

export interface Login {
  title: string;
  url: string;
  username: string;
  password: string;
}

export async function addLogin(popup: Page, login: Login): Promise<void> {
  await popup.getByRole("button", { name: "Add item" }).click();
  await popup.getByRole("menuitem", { name: "Login" }).click();
  await popup.getByLabel("Name", { exact: true }).fill(login.title);
  await popup.getByLabel("Website").fill(login.url);
  await popup.getByLabel("Username").fill(login.username);
  await popup.getByLabel("Password", { exact: true }).fill(login.password);
  await popup.getByRole("button", { name: "Save", exact: true }).click();
  await expect(itemOption(popup, login.title, login.username)).toBeVisible();
}

export function itemOption(popup: Page, title: string, username: string): Locator {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return popup
    .getByRole("listbox", { name: "All items" })
    .getByRole("option", { name: new RegExp(`${escape(title)} ${escape(username)}`) });
}

export async function lockNow(popup: Page): Promise<void> {
  await popup.getByRole("button", { name: "Menu" }).click();
  await popup.getByRole("button", { name: "Lock now" }).click();
}
