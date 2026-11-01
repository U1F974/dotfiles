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

/**
 * @param {*} v
 * @returns {string} v if it is a string, else ''
 */
const str = v => (typeof v === 'string' ? v : '');

/**
 * @param {*} v
 * @returns {Array} v if it is an array, else []
 */
const arr = v => (Array.isArray(v) ? v : []);

/**
 * Client of one org.kde.StatusNotifierItem: its properties, kept up to date,
 * and its methods. Signal: changed, after the properties were loaded again.
 */
export const TrayItem = GObject.registerClass({
    Signals: {
        'changed': {},
    },
}, class TrayItem extends GObject.Object {
    /** @type {Gio.DBusConnection} */
    #connection;
    /** @type {string} */
    #busName;
    /** @type {string} */
    #objectPath;
    /** @type {Object<string, *>} unpacked item properties */
    #props;
    /** @type {number[]} D-Bus signal subscription ids */
    #subIds;
    /** @type {boolean} a load is running */
    #refreshing;
    /** @type {boolean} a signal came during the load: load again */
    #pending;
    /** @type {boolean} */
    #destroyed;
    /** @type {boolean} only the first failed call is logged */
    #errorLogged;

    /**
     * Loads all properties; rejects on error or after 2000 ms of silence.
     * Subscribes first: the match rule reaches the bus before GetAll on the
     * same connection, so no signal sent after GetAll is lost. Signals during
     * the load only set #pending.
     *
     * @param {Gio.DBusConnection} connection
     * @param {string} busName
     * @param {string} objectPath
     * @returns {Promise<TrayItem>}
     */
    static async create(connection, busName, objectPath) {
        const item = new TrayItem(connection, busName, objectPath);
        item.#subscribe();
        item.#refreshing = true;
        try {
            await item.#load();
        } catch (e) {
            item.destroy();
            throw e;
        } finally {
            item.#refreshing = false;
        }
        if (item.#pending)
            item.#refresh();
        return item;
    }

    /**
     * Use create(): the item has no properties until they are loaded.
     *
     * @param {Gio.DBusConnection} connection
     * @param {string} busName
     * @param {string} objectPath
     */
    constructor(connection, busName, objectPath) {
        super();
        this.#connection = connection;
        this.#busName = busName;
        this.#objectPath = objectPath;
        this.#props = {};
        this.#subIds = [];
        this.#refreshing = false;
        this.#pending = false;
        this.#destroyed = false;
        this.#errorLogged = false;
    }

    /** @type {string} Id property */
    get id() {
        return str(this.#props.Id);
    }

    /** @type {string} Title property */
    get title() {
        return str(this.#props.Title);
    }

    /** @type {string} Status property: Passive, Active or NeedsAttention */
    get status() {
        return str(this.#props.Status);
    }

    /** @type {string} IconName property */
    get iconName() {
        return str(this.#props.IconName);
    }

    /** @type {string} IconThemePath property */
    get iconThemePath() {
        return str(this.#props.IconThemePath);
    }

    /** @type {Array<[number, number, Uint8Array]>} IconPixmap property */
    get iconPixmap() {
        return arr(this.#props.IconPixmap);
    }

    /** @type {string} AttentionIconName property */
    get attentionIconName() {
        return str(this.#props.AttentionIconName);
    }

    /** @type {Array<[number, number, Uint8Array]>} AttentionIconPixmap property */
    get attentionIconPixmap() {
        return arr(this.#props.AttentionIconPixmap);
    }

    /** @type {string} title of the ToolTip property */
    get tooltipTitle() {
        return str(arr(this.#props.ToolTip)[2]);
    }

    /** @type {string} Menu property: object path of the DBusMenu, or '' */
    get menuPath() {
        return str(this.#props.Menu);
    }

    /** @type {boolean} ItemIsMenu property: a left click opens the menu */
    get itemIsMenu() {
        return this.#props.ItemIsMenu === true;
    }

    /** @type {boolean} the app wants attention, see isAttention() */
    get attention() {
        return isAttention(this.status, this.iconName);
    }

    /** @type {string} */
    get busName() {
        return this.#busName;
    }

    /** @type {string} */
    get objectPath() {
        return this.#objectPath;
    }

    /**
     * Loads all properties with GetAll.
     */
    async #load() {
        const reply = await this.#connection.call(
            this.#busName, this.#objectPath, 'org.freedesktop.DBus.Properties', 'GetAll',
            new GLib.Variant('(s)', [ITEM_IFACE]), new GLib.VariantType('(a{sv})'),
            Gio.DBusCallFlags.NONE, TIMEOUT_MS, null);
        this.#props = reply.recursiveUnpack()[0];
    }

    /**
     * Subscribes to the signals that announce changed properties.
     */
    #subscribe() {
        if (this.#destroyed)
            return;
        for (const signal of REFRESH_SIGNALS) {
            this.#subIds.push(this.#connection.signal_subscribe(
                this.#busName, ITEM_IFACE, signal, this.#objectPath, null,
                Gio.DBusSignalFlags.NONE, () => this.#scheduleRefresh()));
        }
    }

    /**
     * Loads the properties again, or marks a load as pending if one runs.
     */
    #scheduleRefresh() {
        if (this.#destroyed)
            return;
        if (this.#refreshing) {
            this.#pending = true;
            return;
        }
        this.#refresh();
    }

    /**
     * Loads the properties until no signal came during the load, emits changed
     * after each successful load.
     */
    async #refresh() {
        this.#refreshing = true;
        try {
            do {
                this.#pending = false;
                try {
                    await this.#load();
                } catch (e) {
                    this.#logError(e);
                    continue;
                }
                if (this.#destroyed)
                    return;
                this.emit('changed');
            } while (this.#pending && !this.#destroyed);
        } finally {
            this.#refreshing = false;
        }
    }

    /**
     * Calls an item method; errors are logged.
     *
     * @param {string} method
     * @param {GLib.Variant} params
     */
    #call(method, params) {
        if (this.#destroyed)
            return;
        this.#connection.call(
            this.#busName, this.#objectPath, ITEM_IFACE, method, params, null,
            Gio.DBusCallFlags.NONE, TIMEOUT_MS, null).catch(e => this.#logError(e));
    }

    /**
     * @param {Error} e
     */
    #logError(e) {
        if (this.#errorLogged || this.#destroyed)
            return;
        this.#errorLogged = true;
        console.warn(`tray item ${itemId(this.#busName, this.#objectPath)}: ${e.message}`);
    }

    /**
     * Activate: usually shows the app window.
     *
     * @param {number} x - click position on the stage
     * @param {number} y
     */
    activate(x, y) {
        this.#call('Activate', new GLib.Variant('(ii)', [x, y]));
    }

    /**
     * SecondaryActivate (middle click).
     *
     * @param {number} x - click position on the stage
     * @param {number} y
     */
    secondaryActivate(x, y) {
        this.#call('SecondaryActivate', new GLib.Variant('(ii)', [x, y]));
    }

    /**
     * ContextMenu: the app shows its own menu.
     *
     * @param {number} x - click position on the stage
     * @param {number} y
     */
    contextMenu(x, y) {
        this.#call('ContextMenu', new GLib.Variant('(ii)', [x, y]));
    }

    /**
     * @param {number} delta - steps; > 0 is up/left
     * @param {'vertical'|'horizontal'} orientation
     */
    scroll(delta, orientation) {
        this.#call('Scroll', new GLib.Variant('(is)', [delta, orientation]));
    }

    /**
     * Unsubscribes; calls and loads after this do nothing.
     */
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        for (const id of this.#subIds) {
            try {
                this.#connection.signal_unsubscribe(id);
            } catch (e) {
                // connection already closed
            }
        }
        this.#subIds = [];
    }
});
