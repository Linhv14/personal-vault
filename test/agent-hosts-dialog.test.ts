// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostChips } from "../extension/console/pages/HostChips.js";

afterEach(cleanup);

const props = { name: "STRIPE_SECRET_KEY", value: "sk_live_123456789", editable: true };

describe("agent host chips", () => {
  it("offers the provider's host as a chip and adds it in one click", () => {
    const onChange = vi.fn();
    render(h(HostChips, { ...props, hosts: [], onChange }));
    fireEvent.click(screen.getByRole("button", { name: /api\.stripe\.com/ }));
    expect(onChange).toHaveBeenCalledWith(["api.stripe.com"]);
  });

  it("adds a typed host on Enter and refuses a shared suffix", () => {
    const onChange = vi.fn();
    render(h(HostChips, { ...props, hosts: ["api.stripe.com"], onChange }));
    fireEvent.click(screen.getByRole("button", { name: "Add host" }));
    const input = screen.getByRole("textbox");
    fireEvent.input(input, { target: { value: "*.github.io" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.input(input, { target: { value: "files.stripe.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["api.stripe.com", "files.stripe.com"]);
  });

  it("removes a host with its close button and shows nothing to edit when read only", () => {
    const onChange = vi.fn();
    const { unmount } = render(h(HostChips, { ...props, hosts: ["api.stripe.com"], onChange }));
    fireEvent.click(screen.getByRole("button", { name: "Remove api.stripe.com" }));
    expect(onChange).toHaveBeenCalledWith([]);
    unmount();
    render(h(HostChips, { ...props, editable: false, hosts: ["api.stripe.com"], onChange }));
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
