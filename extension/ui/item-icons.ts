import type { IconName } from "../../src/ui/icons.js";
import type { ItemType } from "../lib/item-types.js";

export const TYPE_ICON: Record<ItemType, IconName> = {
  login: "key",
  note: "note",
  card: "card",
  identity: "person",
  recovery: "life-buoy",
  wifi: "wifi",
  api: "braces",
  ssh: "terminal",
  bank: "bank",
  document: "id-card",
  license: "badge",
};
