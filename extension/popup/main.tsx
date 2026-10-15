import { render } from "preact";
import { useEffect } from "preact/hooks";
import { resumeUnlock } from "../lib/resume.js";
import { getLocal, getUnlocked, loadPendingSignup } from "../lib/storage.js";
import { Toast } from "../ui/components/Toast.js";
import { localeSignal, setUiLocale } from "../ui/i18n.js";
import { Editor } from "./screens/Editor.js";
import { Generator } from "./screens/Generator.js";
import { showLogos } from "./logos.js";
import { Vault } from "./screens/Vault.js";
import { Setup, type SetupProps } from "./screens/Setup.js";
import { Share } from "./screens/Share.js";
import { Unlock } from "./screens/Unlock.js";
import { VaultEditor } from "./screens/VaultEditor.js";
import {
  clockSkew,
  editing,
  editingVault,
  enterVault,
  screen,
  sharing,
  tabUrl,
  toastMessage,
} from "./state.js";

declare const __VAULT_DEFAULT_SERVER__: string | undefined;

function deployedServerUrl(): string {
  return typeof __VAULT_DEFAULT_SERVER__ === "string" ? __VAULT_DEFAULT_SERVER__ : "";
}

let setupProps: SetupProps = { apiUrl: "", defaultServer: "", signup: null };
let unlockEmail = "";

function App() {
  const current = screen.value;
  const locale = localeSignal.value;

  useEffect(() => {
    document.body.dataset["screen"] = current;
  }, [current]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const edit = editing.value;
  const share = sharing.value;
  const inVault = ["list", "edit", "generator", "share", "vault"].includes(current);
  return (
    <>
      {current === "setup" && <Setup {...setupProps} />}
      {current === "unlock" && <Unlock email={unlockEmail} />}
      {inVault && (
        <Vault
          pane={
            current === "edit" ? (
              <Editor key={edit.session} item={edit.item} type={edit.type} />
            ) : current === "vault" ? (
              <VaultEditor key={editingVault.value.session} vault={editingVault.value.vault} />
            ) : current === "generator" ? (
              <Generator />
            ) : current === "share" && share ? (
              <Share key={share.item.id} item={share.item} emailAccess={share.emailAccess} />
            ) : null
          }
        />
      )}
      <Toast message={toastMessage.value} />
    </>
  );
}

async function boot(): Promise<void> {
  const local = await getLocal();
  setUiLocale(local.locale);
  showLogos.value = local.showLogos !== false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl.value = tab?.url;
  clockSkew.value = local.clockSkew ?? 0;

  if (!local.apiUrl || !local.email) {
    const defaultServer = deployedServerUrl();
    setupProps = {
      apiUrl: local.apiUrl ?? defaultServer,
      defaultServer,
      signup: await loadPendingSignup(),
    };
    screen.value = "setup";
    return;
  }

  const session = (await resumeUnlock()) ? await getUnlocked() : null;
  if (!session) {
    unlockEmail = local.email;
    screen.value = "unlock";
    return;
  }
  await enterVault(session.vaultKeyRaw);
}

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app");
render(<App />, root);
void boot();
