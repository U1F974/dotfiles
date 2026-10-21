// Row of tray buttons at the bottom of the Quick Settings grid.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {itemId} from '../logic.js';

// Quick Settings grid width in columns (N_QUICK_SETTINGS_COLUMNS in panel.js).
const QS_COLUMNS = 2;

export const TrayRow = GObject.registerClass(
class TrayRow extends St.BoxLayout {
    constructor(quickSettingsMenu) {
        super({
            style_class: 'tray-qs-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            visible: false,
        });
        this._buttons = new Map(); // id -> TrayButton
        this._enabled = true;

        quickSettingsMenu.addItem(this, QS_COLUMNS);
        // Items appended after us (e.g. by other extensions) would push the row up.
        quickSettingsMenu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this.get_parent()?.set_child_above_sibling(this, null);
        }, this);
    }

    // order: ids in registration order; the button goes before the first later one.
    add(item, button, order = []) {
        const id = itemId(item.busName, item.objectPath);
        this.remove(id);
        const rank = order.indexOf(id);
        const next = rank < 0 ? null : this.get_children().find(b =>
            order.indexOf(itemId(b.item.busName, b.item.objectPath)) > rank);
        this._buttons.set(id, button);
        if (next)
            this.insert_child_below(button, next);
        else
            this.add_child(button);
        item.connectObject('changed', () => this._sync(), button);
        this._sync();
    }

    remove(id) {
        const button = this._buttons.get(id);
        if (!button)
            return;
        this._buttons.delete(id);
        button.destroy();
        this._sync();
    }

    setVisible(visible) {
        this._enabled = visible;
        this._sync();
    }

    _sync() {
        let any = false;
        for (const button of this._buttons.values()) {
            button.visible = button.item.status !== 'Passive';
            any ||= button.visible;
        }
        this.visible = this._enabled && any;
    }
});
