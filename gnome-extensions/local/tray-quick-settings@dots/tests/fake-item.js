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

class FakeItem {
    constructor(connection, objectPath, props, silent, registerMode) {
        this.connection = connection;
        this.uniqueName = connection.get_unique_name();
        this.objectPath = objectPath;
        this.calls = [];
        this._props = {...props};
        this._silent = silent;
        this._registerMode = registerMode;
        this._regIds = [];
        this._closed = false;

        const itemInfo = Gio.DBusNodeInfo.new_for_xml(ITEM_XML).interfaces[0];
        this._regIds.push(connection.register_object(objectPath, itemInfo,
            (conn, sender, path, iface, method, params, invocation) => {
                this.calls.push({method, params: params.recursiveUnpack()});
                invocation.return_value(null);
            }, null, null));

        const propsInfo = Gio.DBusNodeInfo.new_for_xml(PROPS_XML).interfaces[0];
        this._regIds.push(connection.register_object(objectPath, propsInfo,
            (conn, sender, path, iface, method, params, invocation) => {
                if (this._silent)
                    return; // never answer
                if (method === 'Get') {
                    const [, name] = params.deepUnpack();
                    const v = this._props[name];
                    if (v === undefined) {
                        invocation.return_dbus_error('org.freedesktop.DBus.Error.UnknownProperty', name);
                        return;
                    }
                    invocation.return_value(new GLib.Variant('(v)', [v]));
                } else if (method === 'GetAll') {
                    invocation.return_value(new GLib.Variant('(a{sv})', [{...this._props}]));
                }
            }, null, null));
    }

    // name: property name; variant: GLib.Variant of the right type.
    setProp(name, variant) {
        this._props[name] = variant;
    }

    emit(signal, params = null) {
        this.connection.emit_signal(null, this.objectPath, ITEM_IFACE, signal, params);
    }

    async register() {
        const service = this._registerMode === 'path' ? this.objectPath : this.uniqueName;
        await this.connection.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
            'org.kde.StatusNotifierWatcher', 'RegisterStatusNotifierItem',
            new GLib.Variant('(s)', [service]), null, Gio.DBusCallFlags.NONE, 2000, null);
    }

    close() {
        if (this._closed)
            return;
        this._closed = true;
        try {
            this.connection.close_sync(null);
        } catch (e) {
            // already closed
        }
    }
}

export async function makeFakeItem({props = {}, register = 'busName', silent = false, objectPath = '/StatusNotifierItem'} = {}) {
    const connection = Gio.DBusConnection.new_for_address_sync(
        GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
        Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
        Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
        null, null);
    return new FakeItem(connection, objectPath, props, silent, register);
}

