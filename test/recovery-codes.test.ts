import { describe, expect, it } from "vitest";
import { parseRecoveryCodes, titleFromFileName } from "../extension/lib/recovery-codes.js";

describe("recovery codes", () => {
  it.each([
    ["one per line", "a1b2c-3d4e5\r\nf6a7b-8c9d0\n\n", ["a1b2c-3d4e5", "f6a7b-8c9d0"]],
    [
      "Google's two-column printout with a header",
      "BACKUP VERIFICATION CODES\nyou@gmail.com\n\n1. 1234 5678     3. 2345 6789\n2. 3456 7890     4. 4567 8901\n\nGenerated: Oct 13, 2026",
      ["1234 5678", "2345 6789", "3456 7890", "4567 8901"],
    ],
    ["a CSV column with a header", 'code\n"8f3k-2m9q"\n"7x1p-4n6r"\n', ["8f3k-2m9q", "7x1p-4n6r"]],
    [
      "one line with separators",
      "abcd-1234, efgh-5678; ijkl-9012",
      ["abcd-1234", "efgh-5678", "ijkl-9012"],
    ],
    ["space-separated", "q2x9a7c1 z8y7w6v5", ["q2x9a7c1", "z8y7w6v5"]],
    ["a bulleted list", "• 12345678\n- 87654321", ["12345678", "87654321"]],
    ["a code inside a sentence", "Your recovery code: ABCDE-FGHIJ-KLMNO", ["ABCDE-FGHIJ-KLMNO"]],
    ["dates and repeats", "Codes from 2026-10-13\n0042-7781\n0042-7781", ["0042-7781"]],
  ])("reads %s", (_, input, expected) => {
    expect(parseRecoveryCodes(input)).toEqual(expected);
  });

  it("finds nothing in prose", () => {
    expect(parseRecoveryCodes("Keep these codes somewhere safe.")).toEqual([]);
  });

  it.each([
    ["github-recovery-codes.txt", "Github"],
    ["discord_backup_codes.txt", "Discord"],
    ["Dropbox 2FA backup codes.txt", "Dropbox"],
    ["recovery-codes.csv", ""],
  ])("names the item after %s", (fileName, title) => {
    expect(titleFromFileName(fileName)).toBe(title);
  });
});
