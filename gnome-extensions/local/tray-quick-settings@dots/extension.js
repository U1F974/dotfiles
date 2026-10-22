// Tray (StatusNotifierItem host) with icons in a row at the bottom of Quick Settings;
// apps that want attention also get an icon in the panel.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {retry} from './logic.js';
import {Watcher} from './sni/watcher.js';
import {TrayItem} from './sni/item.js';
import {AppMenu} from './ui/appMenu.js';
import {AttentionIndicator} from './ui/attention.js';
import {TrayButton} from './ui/trayButton.js';
import {TrayRow} from './ui/trayRow.js';

// A silent or not yet ready app gets this many more tries, this far apart.
const LOAD_RETRIES = 2;
const LOAD_RETRY_MS = 2000;

export default class TrayExtension extends Extension {
    enable() {
        this._items = new Map(); // id -> TrayItem
        this._loading = new Set(); // ids being loaded
        this._timeouts = new Set(); // GLib sources of retry waits
        this._row = null;
        this._attention = null; // panel item
        this._appMenu = null; // the one open app menu

        this._watcher = new Watcher();
        this._watcherIds = [
            this._watcher.connect('item-added', (_w, id, busName, objectPath) =>
                this._addItem(id, busName, objectPath)),
            this._watcher.connect('item-removed', (_w, id) => this._removeItem(id)),
            this._watcher.connect('name-acquired', () => this._onNameAcquired()),
            this._watcher.connect('name-busy', () => this._onNameBusy()),
        ];
        this._sessionId = Main.sessionMode.connect('updated', () => this._syncVisible());

        this._watcher.start();
    }

    disable() {
        Main.sessionMode.disconnect(this._sessionId);
        this._sessionId = 0;
        for (const id of this._watcherIds)
            this._watcher.disconnect(id);
        this._watcherIds = [];
        this._watcher.stop();
        this._watcher = null;
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts = null;
        this._loading = null;

        this._closeAppMenu();
        this._dropAll();
        this._items = null;
    }

    _onNameAcquired() {
        if (!this._row) {
            this._row = new TrayRow(Main.panel.statusArea.quickSettings.menu);
            this._attention = new AttentionIndicator({
                onOpenMenu: b => this._openMenu(b, false),
            });
            this._syncVisible();
        }
        // After losing and regaining the name the watcher still lists items we dropped.
        for (const id of this._watcher.items) {
            if (this._items.has(id))
                continue;
            const slash = id.indexOf('/');
            this._addItem(id, id.slice(0, slash), id.slice(slash));
        }
    }

    // Another tray host owns the name, or we lost it: no row at all.
    _onNameBusy() {
        this._dropAll();
    }

    _dropAll() {
        this._row?.destroy();
        this._row = null;
        this._attention?.destroy();
        this._attention = null;
        for (const item of this._items.values()) {
            item.disconnectObject(this);
            item.destroy();
        }
        this._items.clear();
    }

    // Also called again for an id the app registers again: a no-op if it is loaded or loading.
    async _addItem(id, busName, objectPath) {
        const watcher = this._watcher;
        const loading = this._loading;
        if (this._items.has(id) || loading.has(id))
            return;
        loading.add(id);
        let item;
        try {
            item = await retry(() => TrayItem.create(Gio.DBus.session, busName, objectPath), {
                retries: LOAD_RETRIES,
                wait: () => this._wait(LOAD_RETRY_MS),
                // Stop once disabled, unregistered, loaded elsewhere or the name is lost.
                keepGoing: () => this._watcher === watcher && watcher.items.includes(id) &&
                    !this._items.has(id) && this._row !== null,
            });
        } catch (e) {
            console.warn(`tray item ${id}: ${e.message}`);
            return;
        } finally {
            loading.delete(id);
        }
        if (!item)
            return;
        // Disabled, removed or name lost while loading.
        if (this._watcher !== watcher || !watcher.items.includes(id) ||
            this._items.has(id) || !this._row) {
            item.destroy();
            return;
        }
        this._items.set(id, item);
        this._row.add(item, new TrayButton(item, {onOpenMenu: b => this._openMenu(b, true)}),
            watcher.items);
        item.connectObject('changed', () => this._syncAttention(), this);
        this._syncAttention();
    }

    _wait(ms) {
        return new Promise(resolve => {
            const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._timeouts.delete(sourceId);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._timeouts.add(sourceId);
        });
    }

    _removeItem(id) {
        const item = this._items.get(id);
        this._items.delete(id);
        this._row?.remove(id);
        this._syncAttention();
        item?.disconnectObject(this);
        item?.destroy();
    }

    _syncAttention() {
        const items = this._watcher.items.map(id => this._items.get(id)).filter(Boolean);
        this._attention?.sync(items);
    }

    // inRow: the button is in the Quick Settings row (else in the panel).
    async _openMenu(button, inRow) {
        this._closeAppMenu();
        const item = button.item;
        const [x, y] = button.stagePoint();
        if (item.menuPath) {
            const menu = new AppMenu(button, item, {
                closeParent: inRow ? () => Main.panel.closeQuickSettings() : () => {},
                side: St.Side.TOP,
            });
            this._appMenu = menu;
            try {
                await menu.open();
                return;
            } catch (e) {
                if (this._appMenu !== menu)
                    return; // replaced, closed or disabled meanwhile
                this._appMenu = null;
            }
        }
        // No usable DBusMenu: the app draws its own popup, which the Quick Settings grab
        // would block.
        if (inRow)
            Main.panel.closeQuickSettings();
        item.contextMenu(x, y);
    }

    _closeAppMenu() {
        this._appMenu?.destroy();
        this._appMenu = null;
    }

    _syncVisible() {
        this._row?.setVisible(!Main.sessionMode.isLocked);
        this._attention?.setVisible(!Main.sessionMode.isLocked);
    }
}
