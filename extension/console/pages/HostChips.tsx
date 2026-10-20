import { useState } from "preact/hooks";
import { suggestHosts } from "../../../src/core/agent-hosts.js";
import { parseHosts } from "../../../src/core/projects.js";
import { Icon } from "../../ui/components/Icon.js";
import { useT } from "../../ui/i18n.js";

export function HostChips({
  hosts,
  name,
  value,
  editable,
  onChange,
}: {
  hosts: string[];
  name: string;
  value: string;
  editable: boolean;
  onChange: (hosts: string[]) => void;
}) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  const suggestions = editable
    ? suggestHosts(name, value).filter((host) => !hosts.includes(host))
    : [];

  const add = (raw: string) => {
    const parsed = parseHosts([...hosts, raw].join(" "));
    if (!parsed || !raw.trim()) {
      setInvalid(true);
      return;
    }
    onChange(parsed);
    setText("");
    setInvalid(false);
    setAdding(false);
  };

  return (
    <div className="host-chips">
      {hosts.map((host) => (
        <span className="host-chip" key={host}>
          {host}
          {editable && (
            <button
              type="button"
              aria-label={t("console.agent_hosts_remove", { host })}
              title={t("console.agent_hosts_remove", { host })}
              onClick={() => onChange(hosts.filter((entry) => entry !== host))}
            >
              <Icon name="close" />
            </button>
          )}
        </span>
      ))}
      {suggestions.map((host) => (
        <button
          type="button"
          className="host-chip suggested"
          key={host}
          title={t("console.agent_hosts_suggested_tip")}
          onClick={() => onChange([...hosts, host])}
        >
          <Icon name="plus" />
          {host}
        </button>
      ))}
      {editable &&
        (adding ? (
          <input
            className={invalid ? "host-input invalid" : "host-input"}
            value={text}
            autoFocus
            spellcheck={false}
            placeholder="api.example.com"
            aria-label={t("console.agent_hosts_add")}
            onInput={(event) => {
              setInvalid(false);
              setText(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add(text);
              }
              if (event.key === "Escape") {
                setAdding(false);
                setText("");
                setInvalid(false);
              }
            }}
            onBlur={() => {
              if (text.trim()) add(text);
              else setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="host-add"
            aria-label={t("console.agent_hosts_add")}
            title={t("console.agent_hosts_add")}
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" />
            {hosts.length === 0 && suggestions.length === 0 && t("console.agent_hosts_add")}
          </button>
        ))}
      {!editable && hosts.length === 0 && <span className="muted">—</span>}
    </div>
  );
}
