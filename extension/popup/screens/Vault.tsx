import type { ComponentChildren } from "preact";
import { Drawer } from "../components/Drawer.js";
import { currentView, ListPane } from "../components/ListPane.js";
import { Notices } from "../components/Notices.js";
import { Topbar } from "../components/Topbar.js";
import { drawerOpen } from "../state.js";
import { Detail } from "./Detail.js";

export function Vault({ pane }: { pane: ComponentChildren }) {
  const state = currentView();
  return (
    <div className="vault">
      <Topbar />
      <Notices />
      <div className="panes">
        <ListPane state={state} />
        <main className="detail-pane">{pane ?? <Detail item={state.selected} />}</main>
      </div>
      {drawerOpen.value && <Drawer />}
    </div>
  );
}
