// com.canonical.dbusmenu client. No Shell imports.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {stripMnemonic} from '../logic.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

const MENU_IFACE = 'com.canonical.dbusmenu';
const TIMEOUT_MS = 2000;

// Layout nodes arrive fully unpacked as [id, {props}, [child, ...]].
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

export const DBusMenuClient = GObject.registerClass({
    Signals: {
        'layout-changed': {},
    },
}, class DBusMenuClient extends GObject.Object {
    _init(connection, busName, objectPath) {
        super._init();
        this._connection = connection;
        this._busName = busName;
        this._objectPath = objectPath;
        this._destroyed = false;
        this._errorLogged = false;
        this._subIds = ['LayoutUpdated', 'ItemsPropertiesUpdated'].map(signal =>
            connection.signal_subscribe(busName, MENU_IFACE, signal, objectPath, null,
                Gio.DBusSignalFlags.NONE, () => {
                    if (!this._destroyed)
                        this.emit('layout-changed');
                }));
    }

    _call(method, params, replyType) {
        return this._connection.call(
            this._busName, this._objectPath, MENU_IFACE, method, params,
            replyType ? new GLib.VariantType(replyType) : null,
            Gio.DBusCallFlags.NONE, TIMEOUT_MS, null);
    }

    // Whole tree from the root, all properties. Rejects on error or after 2000 ms.
    async getLayout() {
        const reply = await this._call('GetLayout',
            new GLib.Variant('(iias)', [0, -1, []]), '(u(ia{sv}av))');
        return parseNode(reply.recursiveUnpack()[1]);
    }

    // Many apps do not implement AboutToShow: errors are ignored.
    async aboutToShow(id) {
        try {
            await this._call('AboutToShow', new GLib.Variant('(i)', [id]), null);
        } catch (e) {
            // not implemented or no answer
        }
    }

    activate(id) {
        if (this._destroyed)
            return;
        const timestamp = Math.floor(GLib.get_monotonic_time() / 1000) >>> 0;
        this._call('Event', new GLib.Variant('(isvu)',
            [id, 'clicked', new GLib.Variant('i', 0), timestamp]), null).catch(e => {
            if (this._errorLogged || this._destroyed)
                return;
            this._errorLogged = true;
            console.warn(`dbusmenu ${this._busName}${this._objectPath}: ${e.message}`);
        });
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
