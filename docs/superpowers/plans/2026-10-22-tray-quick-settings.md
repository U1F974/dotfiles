# Tray in Quick Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GNOME Shell 48 extension that hosts StatusNotifierItem tray icons in a row at the bottom of the Quick Settings menu and shows the icon of an app that wants attention in the top panel.

**Architecture:** The D-Bus side (watcher, item proxy, DBusMenu client) uses only Gio/GLib/GObject, so it runs and is tested under plain `gjs` on a private session bus. The UI side (row, buttons, menus, panel indicator) uses Shell modules and is checked by hand in a nested shell. `extension.js` wires them and keeps the D-Bus side alive across the lock screen.

**Tech Stack:** GJS 1.88 (ESM), Gio D-Bus, St/Clutter, GNOME Shell 48 modules (`quickSettings`, `popupMenu`, `panelMenu`, `main`), POSIX sh for install scripts.

**Spec:** `docs/superpowers/specs/2026-10-22-tray-quick-settings-design.md` (Russian). Read it first; this plan argues from it.

## Global Constraints

- Extension dir: `gnome-extensions/local/tray-quick-settings@dots/`, uuid `tray-quick-settings@dots`.
- `metadata.json`: `"shell-version": ["48"]`, `"session-modes": ["user", "unlock-dialog"]`.
- No third-party libraries, no other extensions. Bus name owned: `org.kde.StatusNotifierWatcher`, object `/StatusNotifierWatcher`; host name `org.kde.StatusNotifierHost-<pid>`.
- Every D-Bus call to an app is async with a 2000 ms timeout; a failing or silent app hides only its own icon. (2000 ms is the plan's choice.)
- Item id format everywhere: `${busName}${objectPath}` (e.g. `:1.42/StatusNotifierItem`).
- Attention rule: `false` if `iconName` contains `mute`; else `true` if `status === 'NeedsAttention'` or `iconName` contains `attention`.
- Items with `status === 'Passive'` are not shown in the row.
- Style: buttons 28x28 px, `border-radius: 3px`, no background; hover `color-mix`-equivalent 8% of the foreground, active 16% (St has no color-mix: use `rgba(255,255,255,0.08)` / `0.16`, the theme is dark).
- All files: ASCII punctuation only (no typographic dashes, quotes, arrows, ellipsis). Code comments in English, like the rest of the repo.
- Tests run with: `dbus-run-session -- gjs -m gnome-extensions/local/tray-quick-settings@dots/tests/run.js` (from repo root). Exit code 0 = all passed.
- Manual checks run in a nested shell: `dbus-run-session -- gnome-shell --nested --wayland` with the extension linked into `~/.local/share/gnome-shell/extensions/` and enabled via `gnome-extensions enable tray-quick-settings@dots` inside that session (apps started with `WAYLAND_DISPLAY` of the nested shell).

## Review Focus

1. An app quits or crashes while its icon is shown (bus name vanishes): its icon disappears from the row and the panel, an open menu of it closes, nothing is logged as an error. Test: Task 2 `item removed when owner vanishes`; manual check in Task 5.
2. An app is restarted and registers again with a new unique name, or calls `RegisterStatusNotifierItem` twice: no duplicate icons. Test: Task 2 `duplicate registration is ignored`.
3. An app answers `Get`/`GetAll` with an error or never answers: that item is not shown, other items still appear. Test: Task 3 `create rejects on silent item`.
4. Vesktop-style icons: each update brings a new `IconThemePath` temp dir and a new `status_icon_N` name, the old dir is deleted: the icon updates and a deleted path never throws. Test: Task 1 `iconFileFor` cases.
5. Repeated `disable()`/`enable()` (and lock/unlock): the bus name is released and owned again, no duplicate rows or panel items. Test: Task 2 `stop releases the name`; manual check in Task 7.

---

### Task 1: Scaffold, test runner, pure logic

**Files:**
- Create: `gnome-extensions/local/tray-quick-settings@dots/metadata.json`
- Create: `gnome-extensions/local/tray-quick-settings@dots/logic.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/tests/run.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/tests/harness.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/tests/logic.test.js`

**Interfaces:**
- Produces (`tests/harness.js`): `test(name: string, fn: () => void | Promise<void>)`, `assertEqual(actual, expected, msg?)` (deep equality via JSON), `assert(cond, msg?)`, `assertRejects(promise): Promise<void>`, `waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void>` (spins the GLib main context). `tests/run.js` imports every `*.test.js` listed in an array, runs tests in order inside a `GLib.MainLoop`, prints `ok`/`FAIL name: error` lines and exits 1 on any failure.
- Produces (`logic.js`, no Shell imports):
  - `parseService(service: string, sender: string): {busName: string, objectPath: string}`
  - `itemId(busName: string, objectPath: string): string`
  - `isAttention(status: string, iconName: string): boolean`
  - `pickPixmap(pixmaps: Array<[number, number, Uint8Array]>, size: number): [number, number, Uint8Array] | null`
  - `argbToRgba(data: Uint8Array): Uint8Array`
  - `stripMnemonic(label: string): string`
  - `iconFileFor(themePath: string, iconName: string): string | null`

- [ ] **Step 1: Write `metadata.json`** with uuid, name `Tray in Quick Settings`, description one line, `shell-version` and `session-modes` from Global Constraints.

- [ ] **Step 2: Write the harness, the runner and the failing tests in `tests/logic.test.js`**

```js
test('parseService: bus name', () =>
    assertEqual(parseService(':1.5', ':1.5'), {busName: ':1.5', objectPath: '/StatusNotifierItem'}));
test('parseService: well-known name', () =>
    assertEqual(parseService('org.kde.foo', ':1.5'), {busName: 'org.kde.foo', objectPath: '/StatusNotifierItem'}));
test('parseService: object path (Electron)', () =>
    assertEqual(parseService('/org/chromium/StatusNotifierItem/1', ':1.9'),
        {busName: ':1.9', objectPath: '/org/chromium/StatusNotifierItem/1'}));
test('itemId', () => assertEqual(itemId(':1.9', '/StatusNotifierItem'), ':1.9/StatusNotifierItem'));
test('isAttention: status', () => assert(isAttention('NeedsAttention', 'app')));
test('isAttention: telegram icon', () => assert(isAttention('Active', 'org.telegram.desktop-attention-symbolic')));
test('isAttention: muted wins', () => assert(!isAttention('NeedsAttention', 'org.telegram.desktop-mute-symbolic')));
test('isAttention: plain', () => assert(!isAttention('Active', 'status_icon_1')));
test('pickPixmap: smallest not below size', () =>
    assertEqual(pickPixmap([[64, 64, a], [16, 16, b], [32, 32, c]], 24)[0], 32));
test('pickPixmap: largest when all smaller', () =>
    assertEqual(pickPixmap([[16, 16, b]], 48)[0], 16));
test('pickPixmap: empty', () => assertEqual(pickPixmap([], 16), null));
test('argbToRgba', () =>
    assertEqual([...argbToRgba(new Uint8Array([0x80, 1, 2, 3]))], [1, 2, 3, 0x80]));
test('stripMnemonic', () => assertEqual(stripMnemonic('_Quit __now'), 'Quit _now'));
test('iconFileFor: png in theme path', () => { /* temp dir with status_icon_1.png */
    assertEqual(iconFileFor(dir, 'status_icon_1'), `${dir}/status_icon_1.png`); });
test('iconFileFor: missing file', () => assertEqual(iconFileFor(dir, 'nope'), null));
test('iconFileFor: deleted dir', () => assertEqual(iconFileFor('/tmp/does-not-exist-xyz', 'a'), null));
test('iconFileFor: empty path', () => assertEqual(iconFileFor('', 'a'), null));
```

(`a`, `b`, `c` are small `Uint8Array`s; `dir` comes from `GLib.dir_make_tmp`.)

- [ ] **Step 3: Run tests, expect failure**

Run: `dbus-run-session -- gjs -m gnome-extensions/local/tray-quick-settings@dots/tests/run.js`
Expected: FAIL lines, exit 1 (logic.js missing exports).

- [ ] **Step 4: Implement `logic.js`.** `iconFileFor` checks `${themePath}/${iconName}.png`, then `.svg`, with `GLib.file_test(..., EXISTS)`; any falsy argument returns `null`.

- [ ] **Step 5: Run tests, expect all `ok`, exit 0.**

- [ ] **Step 6: Commit**

```bash
git add gnome-extensions/local/tray-quick-settings@dots
git commit -m "feat(tray): add extension scaffold and pure tray logic"
```

### Task 2: StatusNotifierWatcher

**Files:**
- Create: `gnome-extensions/local/tray-quick-settings@dots/sni/watcher.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/tests/fake-item.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/tests/watcher.test.js`

**Interfaces:**
- Consumes: `parseService`, `itemId` (Task 1).
- Produces (`sni/watcher.js`): `Watcher` - a `GObject.registerClass` class with signals `item-added (id: string, busName: string, objectPath: string)`, `item-removed (id: string)`, `name-busy ()`, `name-acquired ()`; methods `start(): void`, `stop(): void`; getter `items: string[]` (ids in registration order). Implements methods `RegisterStatusNotifierItem(s)`, `RegisterStatusNotifierHost(s)`, properties `RegisteredStatusNotifierItems (as)`, `IsStatusNotifierHostRegistered (b, true)`, `ProtocolVersion (i, 0)`, signals `StatusNotifierItemRegistered`, `StatusNotifierItemUnregistered`, `StatusNotifierHostRegistered`. Watches each item's bus name and emits `item-removed` when it vanishes. If the name cannot be owned, emits `name-busy` and logs `tray-quick-settings: org.kde.StatusNotifierWatcher is owned by another tray host`.
- Produces (`tests/fake-item.js`): `async makeFakeItem({props, menu, register = 'busName' | 'path', silent = false}): Promise<FakeItem>`; `FakeItem` has `connection` (own `Gio.DBusConnection` from `DBUS_SESSION_BUS_ADDRESS`), `uniqueName`, `objectPath`, `setProp(name, variant)`, `emit(signal, params?)`, `calls: Array<{method, params}>`, `async register()`, `close()`. It exports `org.kde.StatusNotifierItem` and, when `menu` is given, `com.canonical.dbusmenu` at `/MenuBar`. `silent: true` never returns from `Get`/`GetAll`.

- [ ] **Step 1: Write failing tests in `tests/watcher.test.js`**

```js
test('registers by bus name', async () => {
    const w = new Watcher(); const added = []; w.connect('item-added', (_, id) => added.push(id)); w.start();
    const f = await makeFakeItem({}); await f.register();
    await waitFor(() => added.length === 1);
    assertEqual(added[0], `${f.uniqueName}/StatusNotifierItem`); f.close(); w.stop(); });
test('registers by object path (Electron)', async () => { /* register: 'path', objectPath '/org/chromium/StatusNotifierItem/1' */
    assertEqual(added[0], `${f.uniqueName}/org/chromium/StatusNotifierItem/1`); });
test('duplicate registration is ignored', async () => { /* register() twice */ assertEqual(w.items.length, 1); });
test('item removed when owner vanishes', async () => { /* f.close() */ await waitFor(() => removed.length === 1); });
test('RegisteredStatusNotifierItems property', async () => { /* Get via a third connection */
    assertEqual(value, [`${f.uniqueName}/StatusNotifierItem`]); });
test('stop releases the name', async () => {
    w.start(); await waitFor(acquired); w.stop();
    const w2 = new Watcher(); w2.start(); await waitFor(acquired2); w2.stop(); });
test('name-busy when owned elsewhere', async () => { /* own the name on another connection first */
    await waitFor(() => busy); });
```

- [ ] **Step 2: Run tests, expect FAIL** (command from Global Constraints).

- [ ] **Step 3: Implement `fake-item.js` and `Watcher`** with `Gio.bus_own_name` (flags `NONE`, no replace), `Gio.DBusExportedObject.wrapJSObject`, and `Gio.bus_watch_name_on_connection` per item bus name (one watch per bus name, shared by its items). `stop()` unexports, unowns both names, unwatches all, clears items without emitting `item-removed`.

- [ ] **Step 4: Run tests, expect all `ok`.**

- [ ] **Step 5: Commit** `feat(tray): add StatusNotifierWatcher`.

### Task 3: Tray item proxy

**Files:**
- Create: `gnome-extensions/local/tray-quick-settings@dots/sni/item.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/tests/item.test.js`

**Interfaces:**
- Consumes: `isAttention` (Task 1), `makeFakeItem` (Task 2).
- Produces (`sni/item.js`): `TrayItem` (`GObject.registerClass`, signal `changed ()`); `static async create(connection: Gio.DBusConnection, busName: string, objectPath: string): Promise<TrayItem>` - loads all properties with `GetAll` (2000 ms timeout), rejects on error or timeout. Read-only getters: `id`, `title`, `status`, `iconName`, `iconThemePath`, `iconPixmap`, `attentionIconName`, `attentionIconPixmap`, `tooltipTitle`, `menuPath` (`''` if none), `itemIsMenu`, `attention` (= `isAttention(status, iconName)`), `busName`, `objectPath`. Methods (fire and forget, errors logged once with the item id): `activate(x, y)`, `secondaryActivate(x, y)`, `contextMenu(x, y)`, `scroll(delta: number, orientation: 'vertical' | 'horizontal')`, `destroy()`. On any of `NewIcon`, `NewAttentionIcon`, `NewOverlayIcon`, `NewStatus`, `NewTitle`, `NewToolTip`, `NewIconThemePath` it re-reads properties with `GetAll` and emits `changed` once per refresh (coalesce signals that arrive while a refresh is running).

- [ ] **Step 1: Write failing tests in `tests/item.test.js`**

```js
test('create reads Telegram-like props', async () => {
    const f = await makeFakeItem({props: {Id: 'TelegramDesktop', Status: 'Active',
        IconName: 'org.telegram.desktop-symbolic', Menu: '/MenuBar', ItemIsMenu: false}});
    const it = await TrayItem.create(conn, f.uniqueName, f.objectPath);
    assertEqual([it.id, it.status, it.menuPath, it.itemIsMenu, it.attention],
        ['TelegramDesktop', 'Active', '/MenuBar', false, false]); });
test('NewIcon refreshes and emits changed', async () => {
    f.setProp('IconName', 'org.telegram.desktop-attention-symbolic'); f.emit('NewIcon');
    await waitFor(() => changed > 0); assert(it.attention); });
test('NewIconThemePath (Vesktop) refreshes path and name', async () => { /* new path + status_icon_2 */ });
test('activate passes coordinates', async () => {
    it.activate(10, 20); await waitFor(() => f.calls.length);
    assertEqual(f.calls[0], {method: 'Activate', params: [10, 20]}); });
test('scroll passes delta and orientation', async () => { assertEqual(f.calls[0].params, [-1, 'vertical']); });
test('create rejects on silent item', async () => {
    const f = await makeFakeItem({silent: true});
    await assertRejects(TrayItem.create(conn, f.uniqueName, f.objectPath)); });
test('create rejects on missing object', async () => {
    await assertRejects(TrayItem.create(conn, f.uniqueName, '/nope')); });
test('destroy stops changed', async () => { it.destroy(); f.emit('NewIcon'); /* spin 200 ms */ assertEqual(changed, 0); });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `TrayItem`** with `connection.call` + `Gio.DBusCallFlags.NONE` + timeout 2000 and `connection.signal_subscribe(busName, 'org.kde.StatusNotifierItem', null, objectPath, ...)`.
- [ ] **Step 4: Run, expect all `ok`.**
- [ ] **Step 5: Commit** `feat(tray): add StatusNotifierItem proxy`.

### Task 4: DBusMenu client

**Files:**
- Create: `gnome-extensions/local/tray-quick-settings@dots/sni/dbusmenu.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/tests/dbusmenu.test.js`

**Interfaces:**
- Consumes: `stripMnemonic` (Task 1), `makeFakeItem({menu})` (Task 2).
- Produces (`sni/dbusmenu.js`):
  - type `MenuNode = {id: number, label: string, enabled: boolean, visible: boolean, type: 'standard' | 'separator', toggleType: '' | 'checkmark' | 'radio', toggleState: number, iconName: string, iconData: Uint8Array | null, children: MenuNode[]}` (defaults per the DBusMenu spec: enabled/visible `true`, type `standard`, toggleState `-1`).
  - `DBusMenuClient` (`GObject.registerClass`, signal `layout-changed ()` on `LayoutUpdated` and `ItemsPropertiesUpdated`); `constructor(connection, busName, objectPath)`; `async getLayout(): Promise<MenuNode>` (root id 0, depth -1, all properties); `async aboutToShow(id: number): Promise<void>` (errors ignored: many apps do not implement it); `activate(id: number): void` (sends `Event(id, 'clicked', <int32 0>, timestamp)`); `destroy()`.

- [ ] **Step 1: Write failing tests**

```js
test('getLayout parses Telegram-like menu', async () => {
    /* fake menu: root -> [{id 1, label '_Open Telegram'}, {id 2, type 'separator'},
       {id 3, label 'Quit', enabled false}, {id 4, label 'Mute', toggle-type 'checkmark', toggle-state 1},
       {id 5, label 'More', children-display 'submenu', children [{id 6, label 'A'}]}] */
    const root = await client.getLayout();
    assertEqual(root.children.map(c => [c.id, c.label, c.type, c.enabled]),
        [[1, 'Open Telegram', 'standard', true], [2, '', 'separator', true],
         [3, 'Quit', 'standard', false], [4, 'Mute', 'standard', true], [5, 'More', 'standard', true]]);
    assertEqual([root.children[3].toggleType, root.children[3].toggleState], ['checkmark', 1]);
    assertEqual(root.children[4].children[0].label, 'A'); });
test('activate sends clicked event', async () => {
    client.activate(1); await waitFor(() => f.calls.length);
    assertEqual([f.calls[0].method, f.calls[0].params[0], f.calls[0].params[1]], ['Event', 1, 'clicked']); });
test('aboutToShow tolerates missing method', async () => { await client.aboutToShow(0); });
test('LayoutUpdated emits layout-changed', async () => { f.emit('LayoutUpdated', [2, 0]); await waitFor(() => changed); });
test('getLayout rejects on silent menu', async () => { await assertRejects(silentClient.getLayout()); });
```

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `DBusMenuClient`.**
- [ ] **Step 4: Run, expect all `ok`.**
- [ ] **Step 5: Commit** `feat(tray): add DBusMenu client`.

### Task 5: Row in Quick Settings with clickable icons

**Files:**
- Create: `gnome-extensions/local/tray-quick-settings@dots/ui/icon.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/ui/trayButton.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/ui/trayRow.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/extension.js`
- Create: `gnome-extensions/local/tray-quick-settings@dots/stylesheet.css`

**Interfaces:**
- Consumes: `Watcher` (Task 2), `TrayItem` (Task 3), `iconFileFor`, `pickPixmap`, `argbToRgba` (Task 1).
- Produces:
  - `ui/icon.js`: `updateIcon(icon: St.Icon, item: TrayItem, size: number): void` - order: `iconFileFor(item.iconThemePath, item.iconName)` as `Gio.FileIcon`; else themed `item.iconName` (theme lookup must include `item.iconThemePath`); else best `item.iconPixmap` via `pickPixmap(size * scale)` into an `St.ImageContent`; else `image-missing`.
  - `ui/trayButton.js`: `TrayButton` (`St.Button` subclass, style class `tray-qs-button`), `constructor(item: TrayItem, {onOpenMenu: (button: TrayButton) => void})`. Button 1: `onOpenMenu(this)` if `item.itemIsMenu`, else `item.activate(x, y)` and close Quick Settings; button 2: `item.secondaryActivate(x, y)`; button 3: `onOpenMenu(this)` if `item.menuPath`, else `item.contextMenu(x, y)`; scroll: `item.scroll(+-1, orientation)`. Tooltip text: `tooltipTitle || title || id`. Re-renders on `item.changed`.
  - `ui/trayRow.js`: `TrayRow`, `constructor(quickSettingsMenu)`, `add(item: TrayItem, button: TrayButton)`, `remove(id: string)`, `setVisible(visible: boolean)`; the row is one item at the bottom of the Quick Settings grid spanning both columns, with a top separator line; hidden when it has no visible buttons (Passive items are kept but hidden).
  - `extension.js`: `export default class TrayExtension extends Extension` with `enable()`/`disable()`. Owns `this._watcher`, `this._items: Map<string, TrayItem>`, `this._row`. On `item-added` it calls `TrayItem.create` (on rejection: log once, skip) and adds a `TrayButton`; on `item-removed` it destroys both. On `Main.sessionMode` `updated`: UI hidden when `Main.sessionMode.isLocked`, D-Bus side untouched. On `name-busy`: no row at all, the log line from Task 2 is enough.
  - `stylesheet.css`: `.tray-qs-row` (top border 1px, padding-top 8px, spacing 4px), `.tray-qs-button` (28x28, radius 3px, transparent; hover `rgba(255,255,255,0.08)`, active `0.16`).

- [ ] **Step 1: Link and enable in a nested shell** (Global Constraints). Start Telegram and Vesktop inside it.
- [ ] **Step 2: Implement the files above.**
- [ ] **Step 3: Manual check, all must hold:**
  - Row appears at the bottom of Quick Settings with the Telegram and Vesktop icons; Vesktop shows its PNG (with the red dot if unread).
  - Left click on Telegram shows its window and closes Quick Settings; middle click and scroll reach the app (Telegram ignores them: no error in `journalctl --user -f`).
  - Quit Telegram from its own window: its icon disappears, no errors logged. Start it again: one icon, not two.
  - With no tray apps running the row is hidden.
  - `gnome-extensions disable` then `enable` 10 times: one row, icons come back, `busctl --user status org.kde.StatusNotifierWatcher` shows the shell as owner.
- [ ] **Step 4: Run D-Bus tests again, expect all `ok`.**
- [ ] **Step 5: Commit** `feat(tray): show tray icons in Quick Settings`.

### Task 6: App menus

**Files:**
- Create: `gnome-extensions/local/tray-quick-settings@dots/ui/appMenu.js`
- Modify: `gnome-extensions/local/tray-quick-settings@dots/extension.js` (pass `onOpenMenu`)
- Modify: `gnome-extensions/local/tray-quick-settings@dots/stylesheet.css`

**Interfaces:**
- Consumes: `DBusMenuClient`, `MenuNode` (Task 4), `TrayButton` (Task 5).
- Produces (`ui/appMenu.js`): `AppMenu`, `constructor(button: TrayButton, item: TrayItem, {closeParent: () => void, side: St.Side})`; `async open(): Promise<void>` (calls `aboutToShow(0)`, `getLayout()`, builds a `PopupMenu.PopupMenu` anchored to `button`: separators, disabled items insensitive, checkmark/radio as ornaments, submenus as `PopupSubMenuMenuItem`, invisible items skipped, labels via `stripMnemonic`); `close()`; `destroy()`. Rebuilds while open on `layout-changed`. One open `AppMenu` at a time in the whole extension.

  Behavior from the spec: the menu pops up next to the icon **on top of the open Quick Settings menu**, which stays open. The app menu takes the keyboard grab (arrows, Enter, Esc). Esc or a click outside closes only the app menu and gives the grab back to Quick Settings. Choosing an item calls `activate(id)` and closes both menus (`closeParent`). If the app's bus name vanishes while open, the menu closes. If `getLayout()` fails, fall back to `item.contextMenu(x, y)`.

- [ ] **Step 1: Implement `AppMenu`.** Grab handling is the risky part: use the Shell's `Main.pushModal`/`popModal` on the menu actor while open (or a second `PopupMenuManager` attached to the app menu), and verify Quick Settings does not close when the app menu opens.
- [ ] **Step 2: Manual check, all must hold:**
  - Right click on Telegram in the row: its menu shows over Quick Settings next to the icon; Quick Settings stays open.
  - Arrow keys and Enter work in the app menu; Esc closes only the app menu, then Esc closes Quick Settings.
  - Click outside the app menu but inside Quick Settings: only the app menu closes.
  - Choose "Quit Telegram": Telegram quits, both menus close, icon disappears.
  - Vesktop menu works the same; its toggles (if any) show their state.
  - Kill Telegram (`pkill Telegram`) while its menu is open: the menu closes, no errors.
- [ ] **Step 3: Commit** `feat(tray): open app menus over Quick Settings`.

### Task 7: Attention icons in the panel, lock screen

**Files:**
- Create: `gnome-extensions/local/tray-quick-settings@dots/ui/attention.js`
- Modify: `gnome-extensions/local/tray-quick-settings@dots/extension.js`
- Modify: `gnome-extensions/settings/top-bar-organizer.ini`

**Interfaces:**
- Consumes: `TrayItem.attention` (Task 3), `TrayButton` (Task 5), `AppMenu` (Task 6).
- Produces (`ui/attention.js`): `AttentionIndicator` (`PanelMenu.Button` with `dontCreateMenu = true`) added with `Main.panel.addToStatusArea('tray-attention', indicator, <index just left of quickSettings>, 'right')`; holds one `TrayButton` per item with `attention === true` (in registration order); `sync(items: TrayItem[])`; hidden when empty. App menus opened from here use `side: St.Side.TOP` and close nothing else (`closeParent` is a no-op).

- [ ] **Step 1: Add `'tray-attention'` to `right-box-order` in `top-bar-organizer.ini`** right before `'quickSettings'`.
- [ ] **Step 2: Implement `AttentionIndicator`** and call `sync` on every `changed`, `item-added`, `item-removed`.
- [ ] **Step 3: Manual check:**
  - Receive a Telegram message in an unmuted chat: the Telegram icon appears left of the Quick Settings button; read it: the icon goes away.
  - Message in a muted chat: no panel icon.
  - Vesktop unread: no panel icon (by design).
  - Left/right click on the panel icon: same actions as in the row; its menu is a normal panel dropdown.
  - Lock the screen and unlock 5 times: icons stay, no duplicate row or panel items; on the lock screen no tray UI is visible.
- [ ] **Step 4: Commit** `feat(tray): show apps that want attention in the panel`.

### Task 8: Install integration and docs

**Files:**
- Modify: `gnome-extensions/extensions.tsv` (header comment: `local` source; new line `tray-quick-settings@dots	local	-`)
- Modify: `gnome-extensions/install.sh`
- Modify: `README.md`, `README.ru.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: `gnome-extensions/install.sh` handles `source = local` **before** the `installed` check: target `$HOME/.local/share/gnome-shell/extensions/<uuid>`; if it is already a symlink to `$DIR/local/<uuid>` print `ok        <uuid>`; else move an existing dir or file to `<target>.<timestamp>.bak`, `ln -s "$DIR/local/<uuid>" <target>`, print `linked    <uuid>`.

- [ ] **Step 1: Write the sandbox test** (shell, run from repo root):

```sh
T=$(mktemp -d); mkdir -p "$T/bin"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/gsettings"; printf '#!/bin/sh\nexit 0\n' > "$T/bin/gnome-extensions"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/dconf"; chmod +x "$T/bin/"*
# only the local line, to avoid network
grep -E '^#|local' gnome-extensions/extensions.tsv > "$T/tsv"
HOME="$T/home" PATH="$T/bin:$PATH" EXTENSIONS_TSV="$T/tsv" sh gnome-extensions/install.sh
test "$(readlink "$T/home/.local/share/gnome-shell/extensions/tray-quick-settings@dots")" = "$PWD/gnome-extensions/local/tray-quick-settings@dots"
```

Make `install.sh` accept an optional `EXTENSIONS_TSV` environment variable (default `$DIR/extensions.tsv`) so this test can feed the filtered list.

- [ ] **Step 2: Run it, expect the `test` to fail** (no `local` handling yet).
- [ ] **Step 3: Implement `local` in `install.sh`** and the `extensions.tsv` lines.
- [ ] **Step 4: Run it again, expect success; run it twice, second run prints `ok`.**
- [ ] **Step 5: README (en/ru):** "GNOME Shell extensions" section: the `local` source and `tray-quick-settings@dots` (what it does in 3-4 lines: row in Quick Settings, clicks, app menu over Quick Settings, panel icon on attention, muted chats and picture-only unread do not signal, conflicts with AppIndicator). Layout section: `gnome-extensions/local/`. ASCII punctuation check: `grep -nP '[\x{2010}-\x{206F}\x{2190}-\x{21FF}\x{00AB}\x{00BB}\x{00B7}\x{00D7}\x{00A0}\x{202F}]'` on all changed files prints nothing.
- [ ] **Step 6: Commit** `feat(tray): install local extensions from the repo`.
