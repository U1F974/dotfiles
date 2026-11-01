// org.kde.StatusNotifierWatcher implementation. No Shell imports.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {parseService, itemId} from '../logic.js';

const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';
const WATCHER_PATH = '/StatusNotifierWatcher';
const HOST_NAME = `org.kde.StatusNotifierHost-${new Gio.Credentials().get_unix_pid()}`;

const WATCHER_XML = `
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
    <method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
    <signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
    <signal name="StatusNotifierHostRegistered"/>
  </interface>
</node>`;

/**
 * @typedef {object} ItemEntry
 * @property {string} id - see itemId()
 * @property {string} busName
 * @property {string} objectPath
 */

/**
 * The tray name on the session bus: accepts item registrations and reports
 * them. Signals: item-added (id, busName, objectPath), also for an item
 * registered again; item-removed (id) when its bus name vanishes;
 * name-acquired; name-busy (another tray host owns the name).
 */
export const Watcher = GObject.registerClass({
    Signals: {
        'item-added': {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING]},
        'item-removed': {param_types: [GObject.TYPE_STRING]},
        'name-busy': {},
        'name-acquired': {},
    },
}, class Watcher extends GObject.Object {
    /** @type {ItemEntry[]} registered items, in registration order */
    #items;
    /** @type {Map<string, number>} bus name -> name watch id */
    #watches;
    /** @type {number[]} ids of the owned bus names */
    #ownIds;
    /** @type {?Gio.DBusExportedObject} */
    #dbusObject;
    /** @type {boolean} */
    #started;

    constructor() {
        super();
        this.#items = [];
        this.#watches = new Map();
        this.#ownIds = [];
        this.#dbusObject = null;
        this.#started = false;
    }

    /** @type {string[]} ids of the registered items, in registration order */
    get items() {
        return this.#items.map(i => i.id);
    }

    /**
     * Owns org.kde.StatusNotifierWatcher and the host name, exports the
     * watcher object.
     */
    start() {
        if (this.#started)
            return;
        this.#started = true;

        this.#dbusObject = Gio.DBusExportedObject.wrapJSObject(WATCHER_XML, this);

        const watcherId = Gio.bus_own_name(
            Gio.BusType.SESSION, WATCHER_NAME, Gio.BusNameOwnerFlags.NONE,
            (connection, _name) => {
                if (!this.#started)
                    return;
                this.#dbusObject.export(connection, WATCHER_PATH);
            },
            (_connection, _name) => {
                if (!this.#started)
                    return;
                this.emit('name-acquired');
                this.#dbusObject.emit_signal('StatusNotifierHostRegistered', null);
            },
            (_connection, _name) => {
                if (!this.#started)
                    return;
                log('tray-quick-settings: org.kde.StatusNotifierWatcher is owned by another tray host');
                this.emit('name-busy');
            });
        this.#ownIds.push(watcherId);

        this.#ownIds.push(Gio.bus_own_name(
            Gio.BusType.SESSION, HOST_NAME, Gio.BusNameOwnerFlags.NONE,
            null, null, null));
    }

    /**
     * Releases the names and forgets every item.
     */
    stop() {
        if (!this.#started)
            return;
        this.#started = false;

        if (this.#dbusObject) {
            this.#dbusObject.unexport();
            this.#dbusObject = null;
        }
        for (const id of this.#ownIds)
            Gio.bus_unown_name(id);
        this.#ownIds = [];
        for (const id of this.#watches.values())
            Gio.bus_unwatch_name(id);
        this.#watches.clear();
        this.#items = [];
    }

    /**
     * D-Bus: RegisterStatusNotifierItem(s). Async form to get the sender.
     *
     * @param {[string]} params - bus name or object path of the item
     * @param {Gio.DBusMethodInvocation} invocation
     */
    RegisterStatusNotifierItemAsync(params, invocation) {
        const [service] = params;
        const {busName, objectPath} = parseService(service, invocation.get_sender());
        if (!Gio.dbus_is_name(busName) || !GLib.Variant.is_object_path(objectPath)) {
            invocation.return_dbus_error('org.freedesktop.DBus.Error.InvalidArgs',
                `invalid service '${service}'`);
            return;
        }
        this.#addItem(busName, objectPath);
        invocation.return_value(null);
    }

    /**
     * D-Bus: RegisterStatusNotifierHost(s).
     *
     * @param {string} _service - name of the host
     */
    RegisterStatusNotifierHost(_service) {
        // This watcher is its own host; nothing to track.
    }

    /** @type {string[]} D-Bus property */
    get RegisteredStatusNotifierItems() {
        return this.items;
    }

    /** @type {boolean} D-Bus property */
    get IsStatusNotifierHostRegistered() {
        return true;
    }

    /** @type {number} D-Bus property */
    get ProtocolVersion() {
        return 0;
    }

    /**
     * @param {string} busName
     * @param {string} objectPath
     */
    #addItem(busName, objectPath) {
        const id = itemId(busName, objectPath);
        // Registered again: no new entry, but a host whose first load failed may retry.
        if (this.#items.some(i => i.id === id)) {
            this.emit('item-added', id, busName, objectPath);
            return;
        }
        this.#items.push({id, busName, objectPath});

        if (!this.#watches.has(busName)) {
            this.#watches.set(busName, Gio.bus_watch_name(
                Gio.BusType.SESSION, busName, Gio.BusNameWatcherFlags.NONE,
                null,
                () => this.#busNameVanished(busName)));
        }

        this.#dbusObject?.emit_signal('StatusNotifierItemRegistered',
            new GLib.Variant('(s)', [id]));
        this.emit('item-added', id, busName, objectPath);
    }

    /**
     * Drops every item of an app that left the bus.
     *
     * @param {string} busName
     */
    #busNameVanished(busName) {
        const watchId = this.#watches.get(busName);
        if (watchId !== undefined) {
            this.#watches.delete(busName);
            Gio.bus_unwatch_name(watchId);
        }
        const gone = this.#items.filter(i => i.busName === busName);
        this.#items = this.#items.filter(i => i.busName !== busName);
        for (const {id} of gone) {
            this.#dbusObject?.emit_signal('StatusNotifierItemUnregistered',
                new GLib.Variant('(s)', [id]));
            this.emit('item-removed', id);
        }
    }
});
