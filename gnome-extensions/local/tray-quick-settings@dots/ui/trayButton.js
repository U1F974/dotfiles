// Clickable tray icon for one TrayItem.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {updateIcon} from './icon.js';

/** @typedef {import('../sni/item.js').TrayItem} TrayItem */

const ICON_SIZE = 16;
const TOOLTIP_DELAY_MS = 300;

/**
 * Clickable icon of a tray item. Left click: Activate (or the menu if the item
 * is a menu), middle: SecondaryActivate, right: the app menu, wheel: Scroll.
 */
export const TrayButton = GObject.registerClass(
class TrayButton extends St.Button {
    /** @type {?TrayItem} null after destroy */
    #item;
    /** @type {(button: TrayButton) => void} opens the app menu at this button */
    #onOpenMenu;
    /** @type {?St.Label} created on first hover */
    #tooltip;
    /** @type {number} GLib source of the tooltip delay, 0 if none */
    #tooltipId;
    /** @type {number} smooth scroll not yet sent, horizontal */
    #scrollDx;
    /** @type {number} smooth scroll not yet sent, vertical */
    #scrollDy;
    /** @type {St.Icon} */
    #icon;

    /**
     * @param {TrayItem} item
     * @param {object} options
     * @param {(button: TrayButton) => void} options.onOpenMenu - opens the app menu at the button
     */
    constructor(item, {onOpenMenu}) {
        super({
            style_class: 'tray-qs-button',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            can_focus: true,
            track_hover: true,
            reactive: true,
        });
        this.#item = item;
        this.#onOpenMenu = onOpenMenu;
        this.#tooltip = null;
        this.#tooltipId = 0;
        this.#scrollDx = 0;
        this.#scrollDy = 0;

        this.#icon = new St.Icon();
        this.set_child(this.#icon);

        item.connectObject('changed', () => this.#sync(), this);
        this.connect('notify::hover', () => this.#onHover());
        this.connect('notify::mapped', () => {
            if (!this.mapped)
                this.#hideTooltip();
        });
        this.connect('destroy', () => this.#onDestroy());

        this.#sync();
    }

    /** @type {?TrayItem} null after destroy */
    get item() {
        return this.#item;
    }

    /**
     * Center of the button in stage coordinates, for SNI x/y arguments.
     *
     * @returns {[number, number]}
     */
    stagePoint() {
        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_transformed_size();
        return [Math.round(x + w / 2), Math.round(y + h / 2)];
    }

    /**
     * @returns {string} tooltip title, else title, else id of the item
     */
    #tooltipText() {
        const item = this.#item;
        return item.tooltipTitle || item.title || item.id;
    }

    /**
     * Shows the current icon and tooltip of the item.
     */
    #sync() {
        updateIcon(this.#icon, this.#item, ICON_SIZE);
        this.accessible_name = this.#tooltipText();
        this.#tooltip?.set_text(this.#tooltipText());
    }

    /**
     * @param {number} button - Clutter.BUTTON_*
     */
    vfunc_clicked(button) {
        const item = this.#item;
        const [x, y] = this.stagePoint();
        this.#hideTooltip();
        if (button === Clutter.BUTTON_MIDDLE) {
            item.secondaryActivate(x, y);
        } else if (button === Clutter.BUTTON_SECONDARY) {
            this.#onOpenMenu(this);
        } else if (item.itemIsMenu) {
            this.#onOpenMenu(this);
        } else {
            item.activate(x, y);
            Main.panel.closeQuickSettings();
        }
    }

    /**
     * SNI Scroll: delta > 0 is up/left, as Qt's angleDelta.
     *
     * @param {Clutter.Event} event
     * @returns {boolean} Clutter.EVENT_STOP
     */
    vfunc_scroll_event(event) {
        // Mutter sends each wheel step twice (smooth + emulated discrete); take the real one.
        // Stop (not propagate as slider.js does) so no ancestor acts on the twin either.
        if (event.get_flags() & Clutter.EventFlags.FLAG_POINTER_EMULATED)
            return Clutter.EVENT_STOP;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            this.#item.scroll(1, 'vertical');
            break;
        case Clutter.ScrollDirection.DOWN:
            this.#item.scroll(-1, 'vertical');
            break;
        case Clutter.ScrollDirection.LEFT:
            this.#item.scroll(1, 'horizontal');
            break;
        case Clutter.ScrollDirection.RIGHT:
            this.#item.scroll(-1, 'horizontal');
            break;
        case Clutter.ScrollDirection.SMOOTH:
            this.#smoothScroll(...event.get_scroll_delta());
            break;
        }
        return Clutter.EVENT_STOP;
    }

    /**
     * Touchpads send fractional deltas; emit one step per whole unit.
     *
     * @param {number} dx
     * @param {number} dy
     */
    #smoothScroll(dx, dy) {
        this.#scrollDx += dx;
        this.#scrollDy += dy;
        while (Math.abs(this.#scrollDy) >= 1) {
            const step = Math.sign(this.#scrollDy);
            this.#scrollDy -= step;
            this.#item.scroll(-step, 'vertical');
        }
        while (Math.abs(this.#scrollDx) >= 1) {
            const step = Math.sign(this.#scrollDx);
            this.#scrollDx -= step;
            this.#item.scroll(-step, 'horizontal');
        }
    }

    /**
     * Shows the tooltip after a delay on hover, hides it when the pointer leaves.
     */
    #onHover() {
        if (!this.hover) {
            this.#hideTooltip();
            return;
        }
        if (this.#tooltipId)
            return;
        this.#tooltipId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
            this.#tooltipId = 0;
            this.#showTooltip();
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Shows the tooltip above the button, below it if there is no room.
     */
    #showTooltip() {
        const text = this.#tooltipText();
        if (!text || !this.mapped)
            return;
        if (!this.#tooltip) {
            this.#tooltip = new St.Label({style_class: 'dash-label tray-qs-tooltip'});
            Main.uiGroup.add_child(this.#tooltip);
        }
        const tooltip = this.#tooltip;
        tooltip.set_text(text);
        Main.uiGroup.set_child_above_sibling(tooltip, null);
        tooltip.show();

        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_transformed_size();
        const [tw, th] = tooltip.get_size();
        const gap = tooltip.get_theme_node().get_length('-y-offset');
        let ty = y - th - gap;
        if (ty < 0)
            ty = y + h + gap;
        tooltip.set_position(
            Math.clamp(Math.round(x + (w - tw) / 2), 0, global.stage.width - tw),
            Math.round(ty));
    }

    /**
     * Hides the tooltip and cancels a pending one.
     */
    #hideTooltip() {
        if (this.#tooltipId) {
            GLib.source_remove(this.#tooltipId);
            this.#tooltipId = 0;
        }
        this.#tooltip?.hide();
    }

    /**
     * Destroys the tooltip and lets go of the item.
     */
    #onDestroy() {
        this.#hideTooltip();
        this.#tooltip?.destroy();
        this.#tooltip = null;
        this.#item = null;
    }
});
