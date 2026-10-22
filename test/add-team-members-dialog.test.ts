// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddTeamMembersDialog } from "../extension/console/pages/AddTeamMembers.js";
import type { OrgMember } from "../extension/lib/orgs.js";

afterEach(cleanup);

const person = (email: string): OrgMember => ({
  accountId: email,
  email,
  role: "member",
  publicKey: null,
});
const candidates = Array.from({ length: 30 }, (_, index) => person(`dev${index}@acme.io`)).concat(
  person("lead@acme.io"),
);

const box = () => screen.getByRole<HTMLInputElement>("searchbox");
const submit = () => fireEvent.submit(document.querySelector("form")!);

describe("add team members dialog", () => {
  it("keeps a long list short and adds what the search matches", () => {
    const onAdd = vi.fn();
    render(h(AddTeamMembersDialog, { candidates, onClose: () => {}, onAdd }));
    expect(screen.getAllByRole("option")).toHaveLength(8);
    expect(screen.getByText("+23")).toBeTruthy();
    fireEvent.input(box(), { target: { value: "lead" } });
    fireEvent.click(screen.getByRole("option", { name: /lead@acme.io/ }));
    fireEvent.input(box(), { target: { value: "dev1" } });
    fireEvent.click(screen.getByRole("button", { name: /11/ }));
    submit();
    expect(onAdd).toHaveBeenCalledTimes(1);
    const [members, access] = onAdd.mock.calls[0]!;
    expect(members).toHaveLength(12);
    expect(members[0].email).toBe("lead@acme.io");
    expect(access).toBe("edit");
  });

  it("takes a pasted list of emails, flags strangers, and adds them as viewers", () => {
    const onAdd = vi.fn();
    render(h(AddTeamMembersDialog, { candidates, onClose: () => {}, onAdd }));
    const paste = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData: { getData: () => string };
    };
    paste.clipboardData = { getData: () => "Dev2@acme.io, dev3@acme.io\nghost@else.io" };
    fireEvent(box(), paste);
    expect(screen.getByText("ghost@else.io").className).toContain("bad");
    fireEvent.click(screen.getByRole("radio", { checked: false }));
    submit();
    const [members, access] = onAdd.mock.calls[0]!;
    expect(members.map((member: OrgMember) => member.email)).toEqual([
      "dev2@acme.io",
      "dev3@acme.io",
    ]);
    expect(access).toBe("view");
  });
});
