// Fake StatusNotifierItem app on its own bus connection (own unique name).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

const ITEM_IFACE = 'org.kde.StatusNotifierItem';
const ITEM_XML = `
<node>
  <interface name="${ITEM_IFACE}">
    <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
    <signal name="NewTitle"/>
    <signal name="NewIcon"/>
    <signal name="NewAttentionIcon"/>
    <signal name="NewOverlayIcon"/>
    <signal name="NewToolTip"/>
    <signal name="NewStatus"><arg type="s"/></signal>
  </interface>
</node>`;
const PROPS_XML = `
<node>
  <interface name="org.freedesktop.DBus.Properties">
    <method name="Get"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="out"/></method>
    <method name="GetAll"><arg type="s" direction="in"/><arg type="a{sv}" direction="out"/></method>
    <signal name="PropertiesChanged"><arg type="s"/><arg type="a{sv}"/><arg type="as"/></signal>
  </interface>
</node>`;

const MENU_IFACE = 'com.canonical.dbusmenu';
const MENU_PATH = '/MenuBar';
const MENU_XML = withAbout => `
<node>
  <interface name="${MENU_IFACE}">
    <method name="GetLayout">
      <arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/>
      <arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/>
    </method>
    ${withAbout ? '<method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>' : ''}
    <method name="Event">
      <arg type="i" direction="in"/><arg type="s" direction="in"/><arg type="v" direction="in"/><arg type="u" direction="in"/>
    </method>
    <signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
    <signal name="ItemsPropertiesUpdated"><arg type="a(ia{sv})"/><arg type="a(ias)"/></signal>
  </interface>
</node>`;
const MENU_SIGNALS = {LayoutUpdated: '(ui)', ItemsPropertiesUpdated: '(a(ia{sv})a(ias))'};
const MENU_PROP_TYPES = {
    'label': 's', 'type': 's', 'enabled': 'b', 'visible': 'b', 'toggle-type': 's',
    'toggle-state': 'i', 'children-display': 's', 'icon-name': 's',
};

/**
 * @typedef {object} FakeMenuNode
 * @property {number} id
 * @property {Object<string, *>} [props] - label, type, enabled, toggle-type, ...
 * @property {FakeMenuNode[]} [children]
 */

/**
 * @param {FakeMenuNode} node
 * @returns {GLib.Variant} (ia{sv}av) layout node
 */
function menuVariant(node) {
    const props = {};
    for (const [k, v] of Object.entries(node.props ?? {}))
        props[k] = new GLib.Variant(MENU_PROP_TYPES[k] ?? 's', v);
    const children = (node.children ?? []).map(c => new GLib.Variant('v', menuVariant(c)));
    return new GLib.Variant('(ia{sv}av)', [node.id, props, children]);
}

/**
 * A tray app on its own connection: the item, its properties and optionally a
 * DBusMenu. Records the method calls it gets.
 */
class FakeItem {
    /** @type {Object<string, GLib.Variant>} item properties */
    #props;
    /** @type {boolean} never answer Properties and DBusMenu calls */
    #silent;
    /** @type {number} ms before answering Properties calls */
    #propsDelay;
    /** @type {'busName'|'path'} what register() sends */
    #registerMode;
    /** @type {number[]} registered object ids */
    #regIds;
    /** @type {boolean} */
    #closed;

    /**
     * See makeFakeItem() for the arguments.
     *
     * @param {Gio.DBusConnection} connection
     * @param {string} objectPath
     * @param {Object<string, GLib.Variant>} props
     * @param {boolean} silent
     * @param {'busName'|'path'} registerMode
     * @param {?FakeMenuNode} menu
     * @param {boolean} noAboutToShow
     * @param {number} propsDelay
     */
    constructor(connection, objectPath, props, silent, registerMode, menu, noAboutToShow, propsDelay) {
        /** @type {Gio.DBusConnection} */
        this.connection = connection;
        /** @type {string} */
        this.uniqueName = connection.get_unique_name();
        /** @type {string} */
        this.objectPath = objectPath;
        /** @type {Array<{method: string, params: Array}>} calls received, oldest first */
        this.calls = [];
        this.#props = {...props};
        this.#silent = silent;
        this.#propsDelay = propsDelay;
        this.#registerMode = registerMode;
        this.#regIds = [];
        this.#closed = false;

        const itemInfo = Gio.DBusNodeInfo.new_for_xml(ITEM_XML).interfaces[0];
        this.#regIds.push(connection.register_object(objectPath, itemInfo,
            (conn, sender, path, iface, method, params, invocation) => {
                this.calls.push({method, params: params.recursiveUnpack()});
                invocation.return_value(null);
            }, null, null));

        const propsInfo = Gio.DBusNodeInfo.new_for_xml(PROPS_XML).interfaces[0];
        this.#regIds.push(connection.register_object(objectPath, propsInfo,
            (conn, sender, path, iface, method, params, invocation) => {
                if (this.#silent)
                    return; // never answer
                if (this.#propsDelay > 0) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.#propsDelay, () => {
                        this.#answerProps(method, params, invocation);
                        return GLib.SOURCE_REMOVE;
                    });
                    return;
                }
                this.#answerProps(method, params, invocation);
            }, null, null));

        if (menu) {
            const menuInfo = Gio.DBusNodeInfo.new_for_xml(MENU_XML(!noAboutToShow)).interfaces[0];
            this.#regIds.push(connection.register_object(MENU_PATH, menuInfo,
                (conn, sender, path, iface, method, params, invocation) => {
                    this.calls.push({method, params: params.recursiveUnpack()});
                    if (this.#silent)
                        return; // never answer
                    if (method === 'GetLayout') {
                        invocation.return_value(new GLib.Variant('(u(ia{sv}av))',
                            [1, menuVariant(menu).deepUnpack()]));
                    } else if (method === 'AboutToShow') {
                        invocation.return_value(new GLib.Variant('(b)', [false]));
                    } else {
                        invocation.return_value(null);
                    }
                }, null, null));
        }
    }

    /**
     * @param {string} method - Get or GetAll
     * @param {GLib.Variant} params
     * @param {Gio.DBusMethodInvocation} invocation
     */
    #answerProps(method, params, invocation) {
        if (method === 'Get') {
            const [, name] = params.deepUnpack();
            const v = this.#props[name];
            if (v === undefined) {
                invocation.return_dbus_error('org.freedesktop.DBus.Error.UnknownProperty', name);
                return;
            }
            invocation.return_value(new GLib.Variant('(v)', [v]));
        } else if (method === 'GetAll') {
            invocation.return_value(new GLib.Variant('(a{sv})', [{...this.#props}]));
        }
    }

    /**
     * Stop (or start) answering calls that come after this.
     *
     * @param {boolean} silent
     */
    setSilent(silent) {
        this.#silent = silent;
    }

    /**
     * @param {string} name - property name
     * @param {GLib.Variant} variant - value of the right type
     */
    setProp(name, variant) {
        this.#props[name] = variant;
    }

    /**
     * Item signals, plus dbusmenu signals (LayoutUpdated, ItemsPropertiesUpdated).
     *
     * @param {string} signal
     * @param {?(GLib.Variant|Array)} [params] - for dbusmenu signals may be a plain array,
     *   packed by the signal's signature
     */
    emit(signal, params = null) {
        if (signal in MENU_SIGNALS) {
            if (Array.isArray(params))
                params = new GLib.Variant(MENU_SIGNALS[signal], params);
            this.connection.emit_signal(null, MENU_PATH, MENU_IFACE, signal, params);
            return;
        }
        this.connection.emit_signal(null, this.objectPath, ITEM_IFACE, signal, params);
    }

    /**
     * Calls RegisterStatusNotifierItem on the watcher.
     *
     * @returns {Promise<void>}
     */
    async register() {
        const service = this.#registerMode === 'path' ? this.objectPath : this.uniqueName;
        await this.connection.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
            'org.kde.StatusNotifierWatcher', 'RegisterStatusNotifierItem',
            new GLib.Variant('(s)', [service]), null, Gio.DBusCallFlags.NONE, 2000, null);
    }

    /**
     * Closes the connection: the app leaves the bus.
     */
    close() {
        if (this.#closed)
            return;
        this.#closed = true;
        try {
            this.connection.close_sync(null);
        } catch (e) {
            // already closed
        }
    }
}

/**
 * @returns {Gio.DBusConnection} a fresh private connection to the test session bus
 */
export function newConnection() {
    return Gio.DBusConnection.new_for_address_sync(
        GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
        Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
        Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
        null, null);
}

/**
 * @param {object} [options]
 * @param {Object<string, GLib.Variant>} [options.props] - item properties
 * @param {'busName'|'path'} [options.register] - what register() sends
 * @param {boolean} [options.silent] - never answer Properties calls, nor dbusmenu ones
 * @param {string} [options.objectPath]
 * @param {?FakeMenuNode} [options.menu] - dbusmenu tree exported at /MenuBar, e.g.
 *   {id: 0, children: [{id: 1, props: {label: 'Open', type: 'standard', enabled: true,
 *   'toggle-type': 'checkmark', 'toggle-state': 1, 'children-display': 'submenu'}, children: []}]}
 * @param {boolean} [options.noAboutToShow] - leave AboutToShow out of the exported interface
 * @param {number} [options.propsDelay] - answer Properties Get/GetAll after this many ms
 * @returns {Promise<FakeItem>}
 */
export async function makeFakeItem({props = {}, register = 'busName', silent = false, objectPath = '/StatusNotifierItem',
    menu = null, noAboutToShow = false, propsDelay = 0} = {}) {
    const connection = newConnection();
    return new FakeItem(connection, objectPath, props, silent, register, menu, noAboutToShow, propsDelay);
}

