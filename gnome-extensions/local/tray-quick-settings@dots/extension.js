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

/**
 * Tray host: owns the tray name on the bus, loads the registered items and
 * shows them in Quick Settings and, when they want attention, in the panel.
 */
export default class TrayExtension extends Extension {
    /** @type {?Map<string, TrayItem>} item id -> loaded item */
    #items;
    /** @type {?Set<string>} ids of items being loaded */
    #loading;
    /** @type {?Set<number>} GLib sources of retry waits */
    #timeouts;
    /** @type {?TrayRow} null while another host owns the tray name */
    #row;
    /** @type {?AttentionIndicator} panel item */
    #attention;
    /** @type {?AppMenu} the one open app menu */
    #appMenu;
    /** @type {?Watcher} */
    #watcher;
    /** @type {number[]} signal ids on the watcher */
    #watcherIds;
    /** @type {number} signal id on Main.sessionMode */
    #sessionId;

    /**
     * Only empty state here: objects are created in enable().
     *
     * @param {object} metadata - metadata.json
     */
    constructor(metadata) {
        super(metadata);
        this.#items = null;
        this.#loading = null;
        this.#timeouts = null;
        this.#row = null;
        this.#attention = null;
        this.#appMenu = null;
        this.#watcher = null;
        this.#watcherIds = [];
        this.#sessionId = 0;
    }

    /**
     * Starts the watcher; the row appears once the tray name is ours.
     */
    enable() {
        this.#items = new Map();
        this.#loading = new Set();
        this.#timeouts = new Set();

        this.#watcher = new Watcher();
        this.#watcherIds = [
            this.#watcher.connect('item-added', (_w, id, busName, objectPath) =>
                this.#addItem(id, busName, objectPath)),
            this.#watcher.connect('item-removed', (_w, id) => this.#removeItem(id)),
            this.#watcher.connect('name-acquired', () => this.#onNameAcquired()),
            this.#watcher.connect('name-busy', () => this.#onNameBusy()),
        ];
        this.#sessionId = Main.sessionMode.connect('updated', () => this.#syncVisible());

        this.#watcher.start();
    }

    /**
     * Releases the tray name and removes everything from Quick Settings and the panel.
     */
    disable() {
        Main.sessionMode.disconnect(this.#sessionId);
        this.#sessionId = 0;
        for (const id of this.#watcherIds)
            this.#watcher.disconnect(id);
        this.#watcherIds = [];
        this.#watcher.stop();
        this.#watcher = null;
        for (const id of this.#timeouts)
            GLib.source_remove(id);
        this.#timeouts = null;
        this.#loading = null;

        this.#closeAppMenu();
        this.#dropAll();
        this.#items = null;
    }

    /**
     * We own the tray name: create the row and the panel item, load the items.
     */
    #onNameAcquired() {
        if (!this.#row) {
            this.#row = new TrayRow(Main.panel.statusArea.quickSettings.menu);
            this.#attention = new AttentionIndicator({
                onOpenMenu: b => this.#openMenu(b, false),
            });
            this.#syncVisible();
        }
        // After losing and regaining the name the watcher still lists items we dropped.
        for (const id of this.#watcher.items) {
            if (this.#items.has(id))
                continue;
            const slash = id.indexOf('/');
            this.#addItem(id, id.slice(0, slash), id.slice(slash));
        }
    }

    /**
     * Another tray host owns the name, or we lost it: no row at all.
     */
    #onNameBusy() {
        this.#dropAll();
    }

    /**
     * Destroys the row, the panel item and every loaded item.
     */
    #dropAll() {
        this.#row?.destroy();
        this.#row = null;
        this.#attention?.destroy();
        this.#attention = null;
        for (const item of this.#items.values()) {
            item.disconnectObject(this);
            item.destroy();
        }
        this.#items.clear();
    }

    /**
     * Loads a registered item and adds its button. Also called again for an id the app
     * registers again: a no-op if it is loaded or loading.
     *
     * @param {string} id
     * @param {string} busName
     * @param {string} objectPath
     */
    async #addItem(id, busName, objectPath) {
        const watcher = this.#watcher;
        const loading = this.#loading;
        if (this.#items.has(id) || loading.has(id))
            return;
        loading.add(id);
        let item;
        try {
            item = await retry(() => TrayItem.create(Gio.DBus.session, busName, objectPath), {
                retries: LOAD_RETRIES,
                wait: () => this.#wait(LOAD_RETRY_MS),
                // Stop once disabled, unregistered, loaded elsewhere or the name is lost.
                keepGoing: () => this.#watcher === watcher && watcher.items.includes(id) &&
                    !this.#items.has(id) && this.#row !== null,
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
        if (this.#watcher !== watcher || !watcher.items.includes(id) ||
            this.#items.has(id) || !this.#row) {
            item.destroy();
            return;
        }
        this.#items.set(id, item);
        this.#row.add(item, new TrayButton(item, {onOpenMenu: b => this.#openMenu(b, true)}),
            watcher.items);
        item.connectObject('changed', () => this.#syncAttention(), this);
        this.#syncAttention();
    }

    /**
     * A pause that disable() can cancel (it then never resolves).
     *
     * @param {number} ms
     * @returns {Promise<void>}
     */
    #wait(ms) {
        return new Promise(resolve => {
            const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this.#timeouts.delete(sourceId);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this.#timeouts.add(sourceId);
        });
    }

    /**
     * @param {string} id - item whose app left the bus
     */
    #removeItem(id) {
        const item = this.#items.get(id);
        this.#items.delete(id);
        this.#row?.remove(id);
        this.#syncAttention();
        item?.disconnectObject(this);
        item?.destroy();
    }

    /**
     * Updates the panel item with the loaded items in registration order.
     */
    #syncAttention() {
        const items = this.#watcher.items.map(id => this.#items.get(id)).filter(Boolean);
        this.#attention?.sync(items);
    }

    /**
     * Opens the app menu at a button: its DBusMenu, else the app's own menu (ContextMenu).
     *
     * @param {TrayButton} button
     * @param {boolean} inRow - the button is in the Quick Settings row (else in the panel)
     */
    async #openMenu(button, inRow) {
        this.#closeAppMenu();
        const item = button.item;
        const [x, y] = button.stagePoint();
        if (item.menuPath) {
            const menu = new AppMenu(button, item, {
                closeParent: inRow ? () => Main.panel.closeQuickSettings() : () => {},
                side: St.Side.TOP,
            });
            this.#appMenu = menu;
            try {
                await menu.open();
                return;
            } catch (e) {
                if (this.#appMenu !== menu)
                    return; // replaced, closed or disabled meanwhile
                this.#appMenu = null;
            }
        }
        // No usable DBusMenu: the app draws its own popup, which the Quick Settings grab
        // would block.
        if (inRow)
            Main.panel.closeQuickSettings();
        item.contextMenu(x, y);
    }

    /**
     * Closes the open app menu, if any.
     */
    #closeAppMenu() {
        this.#appMenu?.destroy();
        this.#appMenu = null;
    }

    /**
     * Hides the row and the panel item on the lock screen.
     */
    #syncVisible() {
        this.#row?.setVisible(!Main.sessionMode.isLocked);
        this.#attention?.setVisible(!Main.sessionMode.isLocked);
    }
}
