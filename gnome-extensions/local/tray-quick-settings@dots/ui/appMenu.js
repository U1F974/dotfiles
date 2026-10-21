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

import {DBusMenuClient} from '../sni/dbusmenu.js';

function ornamentFor(node) {
    if (node.toggleType === 'checkmark')
        return node.toggleState === 1 ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE;
    if (node.toggleType === 'radio')
        return node.toggleState === 1 ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT;
    return PopupMenu.Ornament.HIDDEN;
}

function iconFor(node) {
    if (node.iconName)
        return new Gio.ThemedIcon({name: node.iconName});
    if (node.iconData?.length)
        return Gio.BytesIcon.new(new GLib.Bytes(node.iconData));
    return null;
}

export class AppMenu {
    // closeParent: closes Quick Settings. side: St.Side of the arrow (flips if no room).
    constructor(button, item, {closeParent, side}) {
        this._button = button;
        this._item = item;
        this._closeParent = closeParent;
        this._side = side;
        this._client = null;
        this._menu = null;
        this._manager = null;
        this._loading = false;
        this._reload = false;
        this._destroyed = false;

        // The app vanished (button removed), the row went away, or Quick Settings closed.
        button.connectObject(
            'destroy', () => this.destroy(),
            'notify::mapped', () => {
                if (!button.mapped)
                    this.close();
            }, this);
    }

    // Shows the menu. Rejects if the app gives no layout or an empty one (caller falls back
    // to ContextMenu).
    // Resolves without showing if the menu was closed or Quick Settings went away meanwhile.
    async open() {
        const {busName, menuPath} = this._item;
        this._client = new DBusMenuClient(Gio.DBus.session, busName, menuPath);
        let root;
        try {
            await this._client.aboutToShow(0);
            root = await this._client.getLayout();
        } catch (e) {
            const gone = this._gone();
            this.destroy();
            if (gone)
                return;
            throw e;
        }
        if (this._gone()) {
            this.destroy();
            return;
        }

        this._menu = new PopupMenu.PopupMenu(this._button, 0.5, this._side);
        // PopupMenu makes Enter/arrows on its source toggle it; the button keeps its own keys.
        this._button.disconnectObject(this._menu);
        this._menu.actor.add_style_class_name('tray-qs-app-menu');
        this._menu.actor.hide();
        Main.uiGroup.add_child(this._menu.actor);
        this._manager = new PopupMenu.PopupMenuManager(this._button);
        this._manager.addMenu(this._menu);
        this._menu.connectObject(
            'open-state-changed', (_m, open) => {
                if (!open)
                    this._onClosed();
            },
            // End of the fade-out after close.
            'menu-closed', () => this.destroy(), this);

        this._build(root);
        this._menu.open(BoxPointer.PopupAnimation.FULL);
        if (!this._menu.isOpen) {
            this.destroy();
            throw new Error('empty menu');
        }
        this._client.connectObject('layout-changed', () => this._rebuild(), this);
    }

    close() {
        if (this._menu?.isOpen)
            this._menu.close(BoxPointer.PopupAnimation.FULL);
        else
            this.destroy();
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._button?.disconnectObject(this);
        this._client?.disconnectObject(this);
        this._client?.destroy();
        this._client = null;
        this._menu?.disconnectObject(this);
        // PopupMenu.destroy() closes it first, which pops our grab via the manager.
        this._menu?.destroy();
        this._menu = null;
        this._manager = null;
        this._button = null;
        this._item = null;
    }

    _gone() {
        return this._destroyed || !this._button.mapped;
    }

    // Without a fade-out (menu-closed comes then) drop everything now. The client lives
    // until then: the item's activate handler runs after the menu has closed.
    _onClosed() {
        if (!this._destroyed && !this._menu.actor.visible)
            this.destroy();
    }

    // layout-changed while open: fetch again, at most one request in flight.
    async _rebuild() {
        if (this._destroyed || !this._menu.isOpen)
            return;
        if (this._loading) {
            this._reload = true;
            return;
        }
        this._loading = true;
        try {
            do {
                this._reload = false;
                let root;
                try {
                    root = await this._client.getLayout();
                } catch (e) {
                    return; // keep the old items; the app may be quitting
                }
                if (this._destroyed || !this._menu.isOpen)
                    return;
                const focus = global.stage.get_key_focus();
                const hadFocus = focus && this._menu.actor.contains(focus);
                this._menu.removeAll();
                this._build(root);
                if (this._menu.isEmpty()) {
                    this.close();
                    return;
                }
                if (hadFocus && !global.stage.get_key_focus())
                    this._menu.actor.grab_key_focus();
            } while (this._reload);
        } finally {
            this._loading = false;
        }
    }

    _build(root) {
        this._addNodes(this._menu, root.children);
    }

    _addNodes(menu, nodes) {
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
                this._addNodes(sub.menu, node.children);
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
                this._client?.activate(node.id);
                this._closeParent();
            });
        }
    }
}
