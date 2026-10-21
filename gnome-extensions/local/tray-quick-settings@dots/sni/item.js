// org.kde.StatusNotifierItem client proxy. No Shell imports.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {isAttention, itemId} from '../logic.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

const ITEM_IFACE = 'org.kde.StatusNotifierItem';
const TIMEOUT_MS = 2000;
const REFRESH_SIGNALS = [
    'NewIcon', 'NewAttentionIcon', 'NewOverlayIcon', 'NewStatus',
    'NewTitle', 'NewToolTip', 'NewIconThemePath',
];

const str = v => (typeof v === 'string' ? v : '');
const arr = v => (Array.isArray(v) ? v : []);

export const TrayItem = GObject.registerClass({
    Signals: {
        'changed': {},
    },
}, class TrayItem extends GObject.Object {
    // Loads all properties; rejects on error or after 2000 ms of silence.
    static async create(connection, busName, objectPath) {
        const item = new TrayItem(connection, busName, objectPath);
        try {
            await item._load();
        } catch (e) {
            item.destroy();
            throw e;
        }
        item._subscribe();
        return item;
    }

    _init(connection, busName, objectPath) {
        super._init();
        this._connection = connection;
        this._busName = busName;
        this._objectPath = objectPath;
        this._props = {};
        this._subIds = [];
        this._refreshing = false;
        this._pending = false;
        this._destroyed = false;
        this._errorLogged = false;
    }

    get id() {
        return str(this._props.Id);
    }

    get title() {
        return str(this._props.Title);
    }

    get status() {
        return str(this._props.Status);
    }

    get iconName() {
        return str(this._props.IconName);
    }

    get iconThemePath() {
        return str(this._props.IconThemePath);
    }

    get iconPixmap() {
        return arr(this._props.IconPixmap);
    }

    get attentionIconName() {
        return str(this._props.AttentionIconName);
    }

    get attentionIconPixmap() {
        return arr(this._props.AttentionIconPixmap);
    }

    get tooltipTitle() {
        return str(arr(this._props.ToolTip)[2]);
    }

    get menuPath() {
        return str(this._props.Menu);
    }

    get itemIsMenu() {
        return this._props.ItemIsMenu === true;
    }

    get attention() {
        return isAttention(this.status, this.iconName);
    }

    get busName() {
        return this._busName;
    }

    get objectPath() {
        return this._objectPath;
    }

    async _load() {
        const reply = await this._connection.call(
            this._busName, this._objectPath, 'org.freedesktop.DBus.Properties', 'GetAll',
            new GLib.Variant('(s)', [ITEM_IFACE]), new GLib.VariantType('(a{sv})'),
            Gio.DBusCallFlags.NONE, TIMEOUT_MS, null);
        this._props = reply.recursiveUnpack()[0];
    }

    _subscribe() {
        if (this._destroyed)
            return;
        for (const signal of REFRESH_SIGNALS) {
            this._subIds.push(this._connection.signal_subscribe(
                this._busName, ITEM_IFACE, signal, this._objectPath, null,
                Gio.DBusSignalFlags.NONE, () => this._scheduleRefresh()));
        }
    }

    _scheduleRefresh() {
        if (this._destroyed)
            return;
        if (this._refreshing) {
            this._pending = true;
            return;
        }
        this._refresh();
    }

    async _refresh() {
        this._refreshing = true;
        try {
            do {
                this._pending = false;
                try {
                    await this._load();
                } catch (e) {
                    this._logError(e);
                    continue;
                }
                if (this._destroyed)
                    return;
                this.emit('changed');
            } while (this._pending && !this._destroyed);
        } finally {
            this._refreshing = false;
        }
    }

    _call(method, params) {
        if (this._destroyed)
            return;
        this._connection.call(
            this._busName, this._objectPath, ITEM_IFACE, method, params, null,
            Gio.DBusCallFlags.NONE, TIMEOUT_MS, null).catch(e => this._logError(e));
    }

    _logError(e) {
        if (this._errorLogged || this._destroyed)
            return;
        this._errorLogged = true;
        console.warn(`tray item ${itemId(this._busName, this._objectPath)}: ${e.message}`);
    }

    activate(x, y) {
        this._call('Activate', new GLib.Variant('(ii)', [x, y]));
    }

    secondaryActivate(x, y) {
        this._call('SecondaryActivate', new GLib.Variant('(ii)', [x, y]));
    }

    contextMenu(x, y) {
        this._call('ContextMenu', new GLib.Variant('(ii)', [x, y]));
    }

    scroll(delta, orientation) {
        this._call('Scroll', new GLib.Variant('(is)', [delta, orientation]));
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        for (const id of this._subIds) {
            try {
                this._connection.signal_unsubscribe(id);
            } catch (e) {
                // connection already closed
            }
        }
        this._subIds = [];
    }
});
