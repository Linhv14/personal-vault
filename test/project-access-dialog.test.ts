// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccessDialog } from "../extension/console/pages/project-dialogs.js";
import type { OrgMember } from "../extension/lib/orgs.js";

afterEach(cleanup);

const members: OrgMember[] = [
  { accountId: "owner", email: "owner@example.com", role: "owner", publicKey: "k" },
  { accountId: "dev", email: "dev@example.com", role: "member", publicKey: "k" },
  { accountId: "intern", email: "intern@example.com", role: "member", publicKey: "k" },
];

describe("project access dialog", () => {
  it("offers read only to members only and saves the marked ones", () => {
    const onSave = vi.fn();
    render(h(AccessDialog, { members, readers: ["dev"], onClose: () => {}, onSave }));
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.submit(document.querySelector("form")!);
    expect(onSave).toHaveBeenCalledWith(["intern"]);
  });
});
