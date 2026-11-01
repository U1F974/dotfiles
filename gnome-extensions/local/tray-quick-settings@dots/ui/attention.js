// Panel item with the icons of apps that want attention, left of Quick Settings.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {TrayButton} from './trayButton.js';

/** @typedef {import('../sni/item.js').TrayItem} TrayItem */

/** Role of the panel item, for addToStatusArea and Top Bar Organizer. */
export const ROLE = 'tray-attention';

/**
 * Panel item left of Quick Settings with the icons of the apps that want
 * attention; hidden when none does.
 */
export const AttentionIndicator = GObject.registerClass(
class AttentionIndicator extends PanelMenu.Button {
    /** @type {(button: TrayButton) => void} opens the app menu at a button */
    #onOpenMenu;
    /** @type {Map<TrayItem, TrayButton>} */
    #buttons;
    /** @type {boolean} false hides the item whatever it has (lock screen) */
    #enabled;
    /** @type {St.BoxLayout} */
    #box;

    /**
     * Adds itself to the panel, left of Quick Settings.
     *
     * @param {object} options
     * @param {(button: TrayButton) => void} options.onOpenMenu - opens the app menu at a button
     */
    constructor({onOpenMenu}) {
        super(0.5, 'Tray attention', true);
        // Each icon has its own hover and focus; the whole panel button does not light up.
        this.track_hover = false;
        this.can_focus = false;
        this.visible = false;

        this.#onOpenMenu = onOpenMenu;
        this.#buttons = new Map();
        this.#enabled = true;

        this.#box = new St.BoxLayout({
            style_class: 'tray-attention-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this.#box);

        const quickSettings = Main.panel.statusArea.quickSettings.container;
        const index = quickSettings.get_parent()?.get_children().indexOf(quickSettings) ?? -1;
        Main.panel.addToStatusArea(ROLE, this, Math.max(index, 0), 'right');
    }

    /**
     * Shows the icons of the items that want attention, in the given order.
     *
     * @param {TrayItem[]} items - all loaded items in registration order
     */
    sync(items) {
        const wanted = items.filter(item => item.attention);
        for (const [item, button] of this.#buttons) {
            if (!wanted.includes(item)) {
                this.#buttons.delete(item);
                button.destroy();
            }
        }
        wanted.forEach((item, i) => {
            let button = this.#buttons.get(item);
            if (!button) {
                button = new TrayButton(item, {onOpenMenu: this.#onOpenMenu});
                this.#buttons.set(item, button);
                this.#box.insert_child_at_index(button, i);
            } else if (this.#box.get_child_at_index(i) !== button) {
                this.#box.set_child_at_index(button, i);
            }
        });
        this.#syncVisible();
    }

    /**
     * @param {boolean} visible - false hides the item whatever it has
     */
    setVisible(visible) {
        this.#enabled = visible;
        this.#syncVisible();
    }

    /**
     * Visible if enabled and some app wants attention.
     */
    #syncVisible() {
        this.visible = this.#enabled && this.#buttons.size > 0;
    }
});
