// DBusMenu of a tray item as a popup menu on top of the open Quick Settings.
//
// Grab: the menu has its own PopupMenuManager, so opening it pushes a second modal grab on
// top of the Quick Settings one. Quick Settings' manager sees no events while ours is on top
// (Clutter delivers them only inside the newest grab), so it stays open. Esc or a click
// outside close our menu, its grab is popped and Quick Settings gets input and focus back.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {itemId} from '../logic.js';
import {DBusMenuClient} from '../sni/dbusmenu.js';

/** @typedef {import('../sni/item.js').TrayItem} TrayItem */
/** @typedef {import('../sni/dbusmenu.js').MenuNode} MenuNode */
/** @typedef {import('./trayButton.js').TrayButton} TrayButton */

/**
 * @param {MenuNode} node
 * @returns {PopupMenu.Ornament} check mark or radio dot of the entry
 */
function ornamentFor(node) {
    if (node.toggleType === 'checkmark')
        return node.toggleState === 1 ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE;
    if (node.toggleType === 'radio')
        return node.toggleState === 1 ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT;
    return PopupMenu.Ornament.HIDDEN;
}

/**
 * @param {MenuNode} node
 * @returns {?Gio.Icon} icon of the entry, by name or PNG data
 */
function iconFor(node) {
    if (node.iconName)
        return new Gio.ThemedIcon({name: node.iconName});
    if (node.iconData?.length)
        return Gio.BytesIcon.new(new GLib.Bytes(node.iconData));
    return null;
}

/**
 * Menu of an app (its DBusMenu), shown at a tray button.
 */
export class AppMenu {
    /** @type {?TrayButton} null after destroy */
    #button;
    /** @type {?TrayItem} null after destroy */
    #item;
    /** @type {() => void} */
    #closeParent;
    /** @type {St.Side} */
    #side;
    /** @type {?DBusMenuClient} */
    #client;
    /** @type {?PopupMenu.PopupMenu} */
    #menu;
    /** @type {?PopupMenu.PopupMenuManager} */
    #manager;
    /** @type {boolean} a layout request is running */
    #loading;
    /** @type {boolean} the layout changed during the request: fetch again */
    #reload;
    /** @type {boolean} */
    #destroyed;

    /**
     * @param {TrayButton} button - the menu points at it
     * @param {TrayItem} item - item with a Menu property
     * @param {object} options
     * @param {() => void} options.closeParent - closes the parent menu (Quick Settings) after
     *   an entry is chosen
     * @param {St.Side} options.side - side of the arrow (flips if no room)
     */
    constructor(button, item, {closeParent, side}) {
        this.#button = button;
        this.#item = item;
        this.#closeParent = closeParent;
        this.#side = side;
        this.#client = null;
        this.#menu = null;
        this.#manager = null;
        this.#loading = false;
        this.#reload = false;
        this.#destroyed = false;

        // The app vanished (button removed), the row went away, or Quick Settings closed.
        button.connectObject(
            'destroy', () => this.destroy(),
            'notify::mapped', () => {
                if (!button.mapped)
                    this.close();
            }, this);
    }

    /**
     * Shows the menu. Rejects if the app gives no layout or an empty one (caller falls back
     * to ContextMenu). A failure to build the menu is logged and resolves: it is a bug here,
     * not a missing menu. Resolves without showing if the menu was closed or Quick Settings
     * went away meanwhile.
     *
     * @returns {Promise<void>}
     */
    async open() {
        const {busName, menuPath} = this.#item;
        this.#client = new DBusMenuClient(Gio.DBus.session, busName, menuPath);
        let root;
        try {
            // Not awaited: a silent AboutToShow must not hold the menu for 2 s. Calls on one
            // connection arrive in order, so the app still sees it before GetLayout.
            this.#client.aboutToShow(0);
            root = await this.#client.getLayout();
        } catch (e) {
            const gone = this.#gone();
            this.destroy();
            if (gone)
                return;
            throw e;
        }
        if (this.#gone()) {
            this.destroy();
            return;
        }

        this.#menu = new PopupMenu.PopupMenu(this.#button, 0.5, this.#side);
        // PopupMenu makes Enter/arrows on its source toggle it; the button keeps its own keys.
        this.#button.disconnectObject(this.#menu);
        this.#menu.actor.add_style_class_name('tray-qs-app-menu');
        this.#menu.actor.hide();
        Main.uiGroup.add_child(this.#menu.actor);
        this.#manager = new PopupMenu.PopupMenuManager(this.#button);
        this.#manager.addMenu(this.#menu);
        this.#menu.connectObject(
            'open-state-changed', (_m, open) => {
                if (!open)
                    this.#onClosed();
            },
            // End of the fade-out after close.
            'menu-closed', () => this.destroy(), this);

        try {
            this.#build(root);
        } catch (e) {
            console.error(`tray menu ${itemId(busName, this.#item.objectPath)}: ${e.message}`);
            this.destroy();
            return;
        }
        this.#menu.open(BoxPointer.PopupAnimation.FULL);
        if (!this.#menu.isOpen) {
            this.destroy();
            throw new Error('empty menu');
        }
        this.#client.connectObject('layout-changed', () => this.#rebuild(), this);
    }

    /**
     * Closes the menu with its animation; destroys it at the end.
     */
    close() {
        if (this.#menu?.isOpen)
            this.#menu.close(BoxPointer.PopupAnimation.FULL);
        else
            this.destroy();
    }

    /**
     * Closes the menu at once and drops everything.
     */
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.#button?.disconnectObject(this);
        this.#client?.disconnectObject(this);
        this.#client?.destroy();
        this.#client = null;
        this.#menu?.disconnectObject(this);
        // PopupMenu.destroy() closes it first, which pops our grab via the manager.
        this.#menu?.destroy();
        this.#menu = null;
        this.#manager = null;
        this.#button = null;
        this.#item = null;
    }

    /**
     * @returns {boolean} destroyed, or the button is no longer on screen
     */
    #gone() {
        return this.#destroyed || !this.#button.mapped;
    }

    /**
     * Without a fade-out (menu-closed comes then) drop everything now. The client lives
     * until then: the item's activate handler runs after the menu has closed.
     */
    #onClosed() {
        if (!this.#destroyed && !this.#menu.actor.visible)
            this.destroy();
    }

    /**
     * layout-changed while open: fetch again, at most one request in flight.
     */
    async #rebuild() {
        if (this.#destroyed || !this.#menu.isOpen)
            return;
        if (this.#loading) {
            this.#reload = true;
            return;
        }
        this.#loading = true;
        try {
            do {
                this.#reload = false;
                let root;
                try {
                    root = await this.#client.getLayout();
                } catch (e) {
                    return; // keep the old items; the app may be quitting
                }
                if (this.#destroyed || !this.#menu.isOpen)
                    return;
                const focus = global.stage.get_key_focus();
                const hadFocus = focus && this.#menu.actor.contains(focus);
                this.#menu.removeAll();
                this.#build(root);
                if (this.#menu.isEmpty()) {
                    this.close();
                    return;
                }
                if (hadFocus && !global.stage.get_key_focus())
                    this.#menu.actor.grab_key_focus();
            } while (this.#reload);
        } finally {
            this.#loading = false;
        }
    }

    /**
     * @param {MenuNode} root
     */
    #build(root) {
        this.#addNodes(this.#menu, root.children);
    }

    /**
     * @param {PopupMenu.PopupMenuBase} menu - the menu or a submenu
     * @param {MenuNode[]} nodes - its entries
     */
    #addNodes(menu, nodes) {
        for (const node of nodes) {
            if (!node.visible)
                continue;
            if (node.type === 'separator') {
                menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }
            if (node.children.length > 0) {
                const sub = new PopupMenu.PopupSubMenuMenuItem(node.label);
                menu.addMenuItem(sub);
                this.#addNodes(sub.menu, node.children);
                sub.setSensitive(node.enabled);
                continue;
            }
            const icon = iconFor(node);
            const menuItem = icon
                ? new PopupMenu.PopupImageMenuItem(node.label, icon)
                : new PopupMenu.PopupMenuItem(node.label);
            menuItem.setOrnament(ornamentFor(node));
            menuItem.setSensitive(node.enabled);
            menu.addMenuItem(menuItem);
            // After the menu's own handler, which closes the menu: then tell the app and
            // close Quick Settings too.
            menuItem.connect_after('activate', () => {
                this.#client?.activate(node.id);
                this.#closeParent();
            });
        }
    }
}
