import { useEffect, useRef, useState } from "preact/hooks";
import { describeError } from "../../../src/i18n/index.js";
import type { IconName } from "../../../src/ui/icons.js";
import type { VaultDef } from "../../lib/vault/types.js";
import { DEFAULT_VAULT_ID, VAULT_COLORS, VAULT_ICONS } from "../../lib/vault/defs.js";
import { Icon } from "../../ui/components/Icon.js";
import { IconButton } from "../../ui/components/IconButton.js";
import { useT } from "../../ui/i18n.js";
import { deleteVault, saveVault, showList } from "../state.js";

export function VaultEditor({ vault }: { vault: VaultDef | null }) {
  const t = useT();
  const name = useRef<HTMLInputElement>(null);
  const [color, setColor] = useState(vault?.color ?? VAULT_COLORS[1]);
  const [icon, setIcon] = useState(vault?.icon ?? VAULT_ICONS[2]);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    name.current?.focus();
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    const title = name.current?.value.trim() ?? "";
    if (!title) {
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await saveVault({ id: vault?.id ?? crypto.randomUUID(), name: title, color, icon });
    } catch (failure) {
      setError(describeError(failure, t));
    } finally {
      setWorking(false);
    }
  };

  const remove = async () => {
    if (!vault) {
      return;
    }
    try {
      await deleteVault(vault);
    } catch (failure) {
      setError(describeError(failure, t));
    }
  };

  return (
    <section id="screen-vault" className="screen">
      <header className="title-bar">
        <IconButton icon="back" label={t("common.back")} onClick={showList} />
        <h1>{t(vault ? "vault.edit" : "vault.new")}</h1>
      </header>
      <form id="form-vault" className="stack" onSubmit={(event) => void submit(event)}>
        <div className="vault-preview" data-color={color}>
          <Icon name={icon as IconName} />
        </div>
        <label>
          <span>{t("vault.name")}</span>
          <input
            ref={name}
            name="name"
            required
            maxLength={40}
            autoComplete="off"
            defaultValue={vault?.name ?? ""}
          />
        </label>
        <fieldset className="choice-group">
          <legend>{t("vault.color")}</legend>
          <div className="swatches" role="radiogroup" aria-label={t("vault.color")}>
            {VAULT_COLORS.map((entry) => (
              <button
                type="button"
                key={entry}
                className="swatch"
                data-color={entry}
                role="radio"
                aria-checked={color === entry}
                aria-label={entry}
                onClick={() => setColor(entry)}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="choice-group">
          <legend>{t("vault.icon")}</legend>
          <div className="icon-choices" role="radiogroup" aria-label={t("vault.icon")}>
            {VAULT_ICONS.map((entry) => (
              <button
                type="button"
                key={entry}
                className="icon-choice"
                role="radio"
                aria-checked={icon === entry}
                aria-label={entry}
                onClick={() => setIcon(entry)}
              >
                <Icon name={entry} />
              </button>
            ))}
          </div>
        </fieldset>
        <button className="primary" type="submit" disabled={working}>
          {t("vault.save")}
        </button>
        {vault && vault.id !== DEFAULT_VAULT_ID && (
          <button
            type="button"
            className="link danger"
            id="vault-delete"
            onClick={() => void remove()}
          >
            {t("vault.delete")}
          </button>
        )}
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
