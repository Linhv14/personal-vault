// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, Secret } from "../extension/lib/projects.js";

const versions = [
  { id: "a", name: "KEY", value: "current", updatedAt: 30, updatedBy: "u" },
  { id: "b", name: "KEY", value: "older", updatedAt: 20, updatedBy: "u" },
  { id: "c", name: "KEY", value: "older", updatedAt: 10, updatedBy: "u" },
];
vi.mock("../extension/lib/projects.js", () => ({ listSecretVersions: async () => versions }));
vi.mock("../extension/console/data.js", () => ({
  toast: vi.fn(),
  useConsole: () => ({ emailOf: () => "me@example.com" }),
  pending$: { value: false },
  failure$: { value: null },
}));

const { SecretHistoryDialog } = await import("../extension/console/pages/SecretHistory.js");

afterEach(cleanup);

const secret = { id: "s", environmentId: "e", name: "KEY", value: "current" } as Secret;

describe("secret history dialog", () => {
  it("lists each earlier value once and restores the one picked", async () => {
    const onRestore = vi.fn();
    const onRevealed = vi.fn();
    render(
      h(SecretHistoryDialog, {
        orgId: "o",
        project: {} as Project,
        secret,
        editable: true,
        onRevealed,
        onRestore,
        onClose: () => {},
      }),
    );
    const restore = await screen.findAllByRole("button", { name: "Restore" });
    expect(restore).toHaveLength(1);
    fireEvent.click(screen.getByText("••••••••••••"));
    expect(onRevealed).toHaveBeenCalledTimes(1);
    expect(screen.getByText("older")).toBeTruthy();
    fireEvent.click(restore[0]!);
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(versions[1]));
  });

  it("hides restore for read-only viewers", async () => {
    render(
      h(SecretHistoryDialog, {
        orgId: "o",
        project: {} as Project,
        secret,
        editable: false,
        onRevealed: () => {},
        onRestore: () => {},
        onClose: () => {},
      }),
    );
    await screen.findByText("••••••••••••");
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });
});
