import { isClearClipboardMessage } from "../lib/clipboard.js";

function overwriteWithEmptyText(event: ClipboardEvent): void {
  event.clipboardData?.setData("text/plain", "");
  event.preventDefault();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isClearClipboardMessage(message)) {
    return;
  }
  document.addEventListener("copy", overwriteWithEmptyText, { once: true });
  const cleared = document.execCommand("copy");
  sendResponse({ cleared });
});
