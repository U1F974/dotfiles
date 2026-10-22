// Panel item with the icons of apps that want attention, left of Quick Settings.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {TrayButton} from './trayButton.js';

export const ROLE = 'tray-attention';

export const AttentionIndicator = GObject.registerClass(
class AttentionIndicator extends PanelMenu.Button {
    constructor({onOpenMenu}) {
        super(0.5, 'Tray attention', true);
        // Each icon has its own hover and focus; the whole panel button does not light up.
        this.track_hover = false;
        this.can_focus = false;
        this.visible = false;

        this._onOpenMenu = onOpenMenu;
        this._buttons = new Map(); // TrayItem -> TrayButton
        this._enabled = true;

        this._box = new St.BoxLayout({
            style_class: 'tray-attention-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._box);

        const quickSettings = Main.panel.statusArea.quickSettings.container;
        const index = quickSettings.get_parent()?.get_children().indexOf(quickSettings) ?? -1;
        Main.panel.addToStatusArea(ROLE, this, Math.max(index, 0), 'right');
    }

    // items: all loaded items in registration order.
    sync(items) {
        const wanted = items.filter(item => item.attention);
        for (const [item, button] of this._buttons) {
            if (!wanted.includes(item)) {
                this._buttons.delete(item);
                button.destroy();
            }
        }
        wanted.forEach((item, i) => {
            let button = this._buttons.get(item);
            if (!button) {
                button = new TrayButton(item, {onOpenMenu: this._onOpenMenu});
                this._buttons.set(item, button);
                this._box.insert_child_at_index(button, i);
            } else if (this._box.get_child_at_index(i) !== button) {
                this._box.set_child_at_index(button, i);
            }
        });
        this._syncVisible();
    }

    setVisible(visible) {
        this._enabled = visible;
        this._syncVisible();
    }

    _syncVisible() {
        this.visible = this._enabled && this._buttons.size > 0;
    }
});
