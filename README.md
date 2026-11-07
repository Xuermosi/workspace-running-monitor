# Workspace Running Monitor

Adds a compact session monitor to the DeepSeek Harness sidebar. It shows one colored status dot beside the settings area and opens a workspace-grouped list on hover.

## Features

- Orange dot: a Session is waiting for approval, plan review, or an answer.
- Green dot: a Session is running, including one directly running subagent.
- Gray dot: a recently ended Session is still relevant.
- Shows at most 10 recently ended Sessions and remembers them across browser/restart reloads.
- Does not replace the Workspace browser; search, grouping, archive, pin, and drag behavior remain provided by DSH.

## Compatibility

Designed for DeepSeek Harness 0.2.x Web client slot APIs.

Requires these client surfaces:

- `sidebar.footer.action`
- `shell.overlay`
- `useSessions`
- `useSessionStatus`
- `useWorkspaces`
- `uiWorkspace.openSession`

## Install

From a local checkout:

```sh
dsh plugin --profile <profile> add /path/to/workspace-running-monitor
```

From GitHub after this repository is published:

```sh
dsh plugin --profile <profile> add github:<owner>/workspace-running-monitor
```

Then refresh or restart the DSH Web UI.

## Behavior Notes

- The monitor row is hidden when no Session needs attention.
- Pending interactions have the highest priority, then running Sessions, then ended Sessions.
- Subagent rows are not listed separately; only their parent Session appears.
- The floating session list groups Sessions by Workspace and uses DSH's current session order.
- The plugin only reads session/status/workspace snapshots. It does not write session data or add Host services.

## Files

- `index.js` – Host-side bundle entry.
- `client.js` – Web client rendering and interaction.
- `cordis.patch.yml` – Cordis composition patch.
- `locale/*.json` – English and Chinese display metadata.
- `icon.svg` – bundle icon.

## License

MIT
