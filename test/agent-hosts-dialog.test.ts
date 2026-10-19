// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostsDialog } from "../extension/console/pages/project-dialogs.js";
import type { Secret } from "../extension/lib/projects.js";

afterEach(cleanup);

const secret: Secret = {
  id: "s1",
  environmentId: "e1",
  name: "STRIPE_SECRET_KEY",
  value: "sk_live_123456789",
  updatedAt: 1,
  updatedBy: "a",
  legacy: false,
};

describe("agent hosts dialog", () => {
  it("offers the provider's host and saves it for every environment by default", () => {
    const onSave = vi.fn();
    render(h(HostsDialog, { secret, environmentCount: 3, onClose: () => {}, onSave }));
    fireEvent.click(screen.getByRole("button", { name: "+ api.stripe.com" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("api.stripe.com");
    expect(screen.queryByRole("button", { name: "+ api.stripe.com" })).toBeNull();
    fireEvent.submit(document.querySelector("form")!);
    expect(onSave).toHaveBeenCalledWith(["api.stripe.com"], true);
  });

  it("can keep the change to one environment, and refuses shared suffixes", () => {
    const onSave = vi.fn();
    render(h(HostsDialog, { secret, environmentCount: 3, onClose: () => {}, onSave }));
    fireEvent.click(screen.getByRole("checkbox"));
    const box = screen.getByRole("textbox");
    fireEvent.input(box, { target: { value: "*.github.io" } });
    fireEvent.submit(document.querySelector("form")!);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.input(box, { target: { value: "api.stripe.com" } });
    fireEvent.submit(document.querySelector("form")!);
    expect(onSave).toHaveBeenCalledWith(["api.stripe.com"], false);
  });
});
