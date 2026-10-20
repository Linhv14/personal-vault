// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultDef, VaultItem } from "../extension/lib/vault.js";

const { TrashList } = await import("../extension/settings/pages/Trash.js");

afterEach(cleanup);

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);

function item(id: string, extra: Partial<VaultItem>): VaultItem {
  return { id, title: id, createdAt: 1, updatedAt: 1, ...extra };
}

const items = [
  item("GitHub", { username: "octo", url: "https://github.com", trashedAt: NOW - 3 * DAY }),
  item("Bank card", { type: "card", cardholder: "Ann", trashedAt: NOW - 29 * DAY }),
  item("Team login", { vault: "team:ops", username: "ops", trashedAt: NOW - DAY }),
  item("Read only", { vault: "team:ro", trashedAt: NOW - DAY }),
];
const vaults: VaultDef[] = [
  {
    id: "team:ops",
    name: "Ops",
    color: "blue",
    icon: "briefcase",
    shared: { orgName: "Acme", rekeyNeeded: false },
  },
  {
    id: "team:ro",
    name: "Docs",
    color: "green",
    icon: "briefcase",
    shared: { orgName: "Acme", rekeyNeeded: false, viewOnly: true },
  },
];

function setup(list = items) {
  const onRestore = vi.fn(async () => {});
  const onDelete = vi.fn(async () => {});
  render(h(TrashList, { items: list, vaults, now: NOW, onRestore, onDelete }));
  return { onRestore, onDelete };
}

const button = (name: string | RegExp) =>
  within(document.querySelector<HTMLElement>(".toolbar")!).getByRole("button", { name });
const ids = (calls: unknown[][]) => (calls[0]![0] as VaultItem[]).map(({ id }) => id);

describe("trash page", () => {
  it("lists trashed items with their subtitle, vault and purge countdown", () => {
    setup();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(screen.getByText("octo")).toBeTruthy();
    expect(screen.getByText("Ann")).toBeTruthy();
    expect(screen.getByText("Ops")).toBeTruthy();
    expect(screen.getByText("Purges in 27 days")).toBeTruthy();
    expect(screen.getByText("Purges in 1 day")).toBeTruthy();
    expect(screen.getByText("3 days ago")).toBeTruthy();
    const team = document.querySelector('tr[data-id="Team login"]')!;
    expect(team.textContent).not.toContain("Purges");
  });

  it("shows an empty state", () => {
    setup([]);
    expect(screen.getByText("Trash is empty")).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
  });

  it("filters by title", () => {
    setup();
    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "git" } });
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "nothing" } });
    expect(screen.getByText("No items match")).toBeTruthy();
  });

  it("selects every editable item and restores them in bulk", async () => {
    const { onRestore } = setup();
    expect((button("Restore") as HTMLButtonElement).disabled).toBe(true);
    expect((button("Delete forever") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(button("Restore 3"));
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(ids(onRestore.mock.calls)).toEqual(["GitHub", "Bank card", "Team login"]);
    await waitFor(() => expect(button("Restore")).toBeTruthy());
  });

  it("restores one item from its row", async () => {
    const { onRestore } = setup();
    const row = document.querySelector('tr[data-id="Bank card"]')!;
    fireEvent.click(row.querySelector<HTMLButtonElement>('button[aria-label="Restore"]')!);
    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(ids(onRestore.mock.calls)).toEqual(["Bank card"]);
  });

  it("deletes the selection forever after confirming", async () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select GitHub" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bank card" }));
    fireEvent.click(button("Delete 2 forever"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Delete 2 items forever?")).toBeTruthy();
    expect(document.querySelector("dialog.danger")).not.toBeNull();
    fireEvent.submit(document.querySelector("dialog form")!);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(ids(onDelete.mock.calls)).toEqual(["GitHub", "Bank card"]);
    await waitFor(() => expect(document.querySelector("dialog")).toBeNull());
  });

  it("empties the trash except view-only items, and cancel keeps everything", async () => {
    const { onDelete } = setup();
    fireEvent.click(button("Empty trash"));
    expect(screen.getByText("Empty trash?")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);
    expect(document.querySelector("dialog")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(button("Empty trash"));
    fireEvent.submit(document.querySelector("dialog form")!);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(ids(onDelete.mock.calls)).toEqual(["GitHub", "Bank card", "Team login"]);
  });

  it("does not let view-only items be selected", () => {
    setup();
    const box = screen.getByRole("checkbox", { name: "Select Read only" }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });
});
