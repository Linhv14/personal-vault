import type { AutofillRequest, AutofillResponse } from "../autofill-protocol.js";
import type { TrustedSender } from "./senders.js";

export type AutofillHandlers<K extends AutofillRequest["type"]> = {
  [T in K]: (
    request: Extract<AutofillRequest, { type: T }>,
    sender: TrustedSender,
  ) => Promise<AutofillResponse>;
};
