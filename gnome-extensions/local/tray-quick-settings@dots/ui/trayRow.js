// Row of tray buttons at the bottom of the Quick Settings grid.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {itemId} from '../logic.js';

/** @typedef {import('../sni/item.js').TrayItem} TrayItem */
/** @typedef {import('./trayButton.js').TrayButton} TrayButton */

// Quick Settings grid width in columns (N_QUICK_SETTINGS_COLUMNS in panel.js).
const QS_COLUMNS = 2;

/**
 * Row of tray buttons across the bottom of the Quick Settings menu. Hidden
 * when it has no visible button (Passive items are hidden).
 */
export const TrayRow = GObject.registerClass(
class TrayRow extends St.BoxLayout {
    /** @type {Map<string, TrayButton>} item id -> button */
    #buttons;
    /** @type {boolean} false hides the row whatever it has (lock screen) */
    #enabled;

    /**
     * Adds itself to the menu.
     *
     * @param {import('resource:///org/gnome/shell/ui/quickSettings.js').QuickSettingsMenu} quickSettingsMenu
     */
    constructor(quickSettingsMenu) {
        super({
            style_class: 'tray-qs-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            visible: false,
        });
        this.#buttons = new Map();
        this.#enabled = true;

        quickSettingsMenu.addItem(this, QS_COLUMNS);
        // Items appended after us (e.g. by other extensions) would push the row up.
        quickSettingsMenu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this.get_parent()?.set_child_above_sibling(this, null);
        }, this);
    }

    /**
     * Adds the button of an item, replacing an older one of the same item.
     *
     * @param {TrayItem} item
     * @param {TrayButton} button
     * @param {string[]} [order] - item ids in registration order; the button goes before the
     *   first later one
     */
    add(item, button, order = []) {
        const id = itemId(item.busName, item.objectPath);
        this.remove(id);
        const rank = order.indexOf(id);
        const next = rank < 0 ? null : this.get_children().find(b =>
            order.indexOf(itemId(b.item.busName, b.item.objectPath)) > rank);
        this.#buttons.set(id, button);
        if (next)
            this.insert_child_below(button, next);
        else
            this.add_child(button);
        item.connectObject('changed', () => this.#sync(), button);
        this.#sync();
    }

    /**
     * Removes and destroys the button of an item, if there is one.
     *
     * @param {string} id - item id
     */
    remove(id) {
        const button = this.#buttons.get(id);
        if (!button)
            return;
        this.#buttons.delete(id);
        button.destroy();
        this.#sync();
    }

    /**
     * @param {boolean} visible - false hides the row whatever it has
     */
    setVisible(visible) {
        this.#enabled = visible;
        this.#sync();
    }

    /**
     * Hides Passive items, and the row if nothing is left to show.
     */
    #sync() {
        let any = false;
        for (const button of this.#buttons.values()) {
            button.visible = button.item.status !== 'Passive';
            any ||= button.visible;
        }
        this.visible = this.#enabled && any;
    }
});
