// Clickable tray icon for one TrayItem.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {updateIcon} from './icon.js';

const ICON_SIZE = 16;
const TOOLTIP_DELAY_MS = 300;

export const TrayButton = GObject.registerClass(
class TrayButton extends St.Button {
    constructor(item, {onOpenMenu}) {
        super({
            style_class: 'tray-qs-button',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            can_focus: true,
            track_hover: true,
            reactive: true,
        });
        this._item = item;
        this._onOpenMenu = onOpenMenu;
        this._tooltip = null;
        this._tooltipId = 0;
        this._scrollDx = 0;
        this._scrollDy = 0;

        this._icon = new St.Icon();
        this.set_child(this._icon);

        item.connectObject('changed', () => this._sync(), this);
        this.connect('notify::hover', () => this._onHover());
        this.connect('notify::mapped', () => {
            if (!this.mapped)
                this._hideTooltip();
        });
        this.connect('destroy', () => this._onDestroy());

        this._sync();
    }

    get item() {
        return this._item;
    }

    // Center of the button in stage coordinates, for SNI x/y arguments.
    stagePoint() {
        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_transformed_size();
        return [Math.round(x + w / 2), Math.round(y + h / 2)];
    }

    _tooltipText() {
        const item = this._item;
        return item.tooltipTitle || item.title || item.id;
    }

    _sync() {
        updateIcon(this._icon, this._item, ICON_SIZE);
        this.accessible_name = this._tooltipText();
        this._tooltip?.set_text(this._tooltipText());
    }

    vfunc_clicked(button) {
        const item = this._item;
        const [x, y] = this.stagePoint();
        this._hideTooltip();
        if (button === Clutter.BUTTON_MIDDLE) {
            item.secondaryActivate(x, y);
        } else if (button === Clutter.BUTTON_SECONDARY) {
            if (item.menuPath)
                this._onOpenMenu(this);
            else
                item.contextMenu(x, y);
        } else if (item.itemIsMenu) {
            this._onOpenMenu(this);
        } else {
            item.activate(x, y);
            Main.panel.closeQuickSettings();
        }
    }

    // SNI Scroll: delta > 0 is up/left, as Qt's angleDelta.
    vfunc_scroll_event(event) {
        // Mutter sends each wheel step twice (smooth + emulated discrete); take the real one.
        // Stop (not propagate as slider.js does) so no ancestor acts on the twin either.
        if (event.get_flags() & Clutter.EventFlags.FLAG_POINTER_EMULATED)
            return Clutter.EVENT_STOP;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            this._item.scroll(1, 'vertical');
            break;
        case Clutter.ScrollDirection.DOWN:
            this._item.scroll(-1, 'vertical');
            break;
        case Clutter.ScrollDirection.LEFT:
            this._item.scroll(1, 'horizontal');
            break;
        case Clutter.ScrollDirection.RIGHT:
            this._item.scroll(-1, 'horizontal');
            break;
        case Clutter.ScrollDirection.SMOOTH:
            this._smoothScroll(...event.get_scroll_delta());
            break;
        }
        return Clutter.EVENT_STOP;
    }

    // Touchpads send fractional deltas; emit one step per whole unit.
    _smoothScroll(dx, dy) {
        this._scrollDx += dx;
        this._scrollDy += dy;
        while (Math.abs(this._scrollDy) >= 1) {
            const step = Math.sign(this._scrollDy);
            this._scrollDy -= step;
            this._item.scroll(-step, 'vertical');
        }
        while (Math.abs(this._scrollDx) >= 1) {
            const step = Math.sign(this._scrollDx);
            this._scrollDx -= step;
            this._item.scroll(-step, 'horizontal');
        }
    }

    _onHover() {
        if (!this.hover) {
            this._hideTooltip();
            return;
        }
        if (this._tooltipId)
            return;
        this._tooltipId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
            this._tooltipId = 0;
            this._showTooltip();
            return GLib.SOURCE_REMOVE;
        });
    }

    _showTooltip() {
        const text = this._tooltipText();
        if (!text || !this.mapped)
            return;
        if (!this._tooltip) {
            this._tooltip = new St.Label({style_class: 'dash-label tray-qs-tooltip'});
            Main.uiGroup.add_child(this._tooltip);
        }
        const tooltip = this._tooltip;
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

    _hideTooltip() {
        if (this._tooltipId) {
            GLib.source_remove(this._tooltipId);
            this._tooltipId = 0;
        }
        this._tooltip?.hide();
    }

    _onDestroy() {
        this._hideTooltip();
        this._tooltip?.destroy();
        this._tooltip = null;
        this._item = null;
    }
});
