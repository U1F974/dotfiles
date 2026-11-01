// com.canonical.dbusmenu client. No Shell imports.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {stripMnemonic} from '../logic.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

const MENU_IFACE = 'com.canonical.dbusmenu';
const TIMEOUT_MS = 2000;

/**
 * One menu entry with its submenu.
 *
 * @typedef {object} MenuNode
 * @property {number} id
 * @property {string} label - without mnemonics
 * @property {boolean} enabled
 * @property {boolean} visible
 * @property {'standard'|'separator'} type
 * @property {'checkmark'|'radio'|''} toggleType
 * @property {number} toggleState - 1 on, 0 off, -1 none
 * @property {string} iconName
 * @property {?Uint8Array} iconData - PNG
 * @property {MenuNode[]} children
 */

/**
 * Layout nodes arrive fully unpacked as [id, {props}, [child, ...]].
 *
 * @param {[number, ?Object<string, *>, ?Array]} raw
 * @returns {MenuNode}
 */
function parseNode(raw) {
    const [id, props, children] = raw;
    const p = props ?? {};
    return {
        id,
        label: stripMnemonic(typeof p.label === 'string' ? p.label : ''),
        enabled: p.enabled ?? true,
        visible: p.visible ?? true,
        type: p.type === 'separator' ? 'separator' : 'standard',
        toggleType: p['toggle-type'] === 'checkmark' || p['toggle-type'] === 'radio' ? p['toggle-type'] : '',
        toggleState: typeof p['toggle-state'] === 'number' ? p['toggle-state'] : -1,
        iconName: typeof p['icon-name'] === 'string' ? p['icon-name'] : '',
        iconData: p['icon-data'] instanceof Uint8Array ? p['icon-data'] : null,
        children: (children ?? []).map(parseNode),
    };
}

/**
 * Client of one com.canonical.dbusmenu. Signal: layout-changed, when the app
 * changed the menu.
 */
export const DBusMenuClient = GObject.registerClass({
    Signals: {
        'layout-changed': {},
    },
}, class DBusMenuClient extends GObject.Object {
    /** @type {Gio.DBusConnection} */
    #connection;
    /** @type {string} */
    #busName;
    /** @type {string} */
    #objectPath;
    /** @type {boolean} */
    #destroyed;
    /** @type {boolean} only the first failed Event is logged */
    #errorLogged;
    /** @type {number[]} D-Bus signal subscription ids */
    #subIds;

    /**
     * @param {Gio.DBusConnection} connection
     * @param {string} busName
     * @param {string} objectPath - Menu property of the item
     */
    constructor(connection, busName, objectPath) {
        super();
        this.#connection = connection;
        this.#busName = busName;
        this.#objectPath = objectPath;
        this.#destroyed = false;
        this.#errorLogged = false;
        this.#subIds = ['LayoutUpdated', 'ItemsPropertiesUpdated'].map(signal =>
            connection.signal_subscribe(busName, MENU_IFACE, signal, objectPath, null,
                Gio.DBusSignalFlags.NONE, () => {
                    if (!this.#destroyed)
                        this.emit('layout-changed');
                }));
    }

    /**
     * @param {string} method
     * @param {GLib.Variant} params
     * @param {?string} replyType - signature of the reply, null for none
     * @returns {Promise<GLib.Variant>}
     */
    #call(method, params, replyType) {
        return this.#connection.call(
            this.#busName, this.#objectPath, MENU_IFACE, method, params,
            replyType ? new GLib.VariantType(replyType) : null,
            Gio.DBusCallFlags.NONE, TIMEOUT_MS, null);
    }

    /**
     * Whole tree from the root, all properties. Rejects on error or after 2000 ms.
     *
     * @returns {Promise<MenuNode>}
     */
    async getLayout() {
        const reply = await this.#call('GetLayout',
            new GLib.Variant('(iias)', [0, -1, []]), '(u(ia{sv}av))');
        return parseNode(reply.recursiveUnpack()[1]);
    }

    /**
     * Many apps do not implement AboutToShow: errors are ignored.
     *
     * @param {number} id - entry whose submenu is about to show, 0 for the root
     */
    async aboutToShow(id) {
        try {
            await this.#call('AboutToShow', new GLib.Variant('(i)', [id]), null);
        } catch (e) {
            // not implemented or no answer
        }
    }

    /**
     * Sends a click on an entry.
     *
     * @param {number} id
     */
    activate(id) {
        if (this.#destroyed)
            return;
        const timestamp = Math.floor(GLib.get_monotonic_time() / 1000) >>> 0;
        this.#call('Event', new GLib.Variant('(isvu)',
            [id, 'clicked', new GLib.Variant('i', 0), timestamp]), null).catch(e => {
            if (this.#errorLogged || this.#destroyed)
                return;
            this.#errorLogged = true;
            console.warn(`dbusmenu ${this.#busName}${this.#objectPath}: ${e.message}`);
        });
    }

    /**
     * Unsubscribes; activate() after this does nothing.
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
