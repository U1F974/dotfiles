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

export const Watcher = GObject.registerClass({
    Signals: {
        'item-added': {param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING]},
        'item-removed': {param_types: [GObject.TYPE_STRING]},
        'name-busy': {},
        'name-acquired': {},
    },
}, class Watcher extends GObject.Object {
    _init() {
        super._init();
        this._items = []; // [{id, busName, objectPath}]
        this._watches = new Map(); // busName -> watch id
        this._ownIds = [];
        this._dbusObject = null;
        this._started = false;
    }

    get items() {
        return this._items.map(i => i.id);
    }

    start() {
        if (this._started)
            return;
        this._started = true;

        this._dbusObject = Gio.DBusExportedObject.wrapJSObject(WATCHER_XML, this);

        const watcherId = Gio.bus_own_name(
            Gio.BusType.SESSION, WATCHER_NAME, Gio.BusNameOwnerFlags.NONE,
            (connection, _name) => {
                if (!this._started)
                    return;
                this._connection = connection;
                this._dbusObject.export(connection, WATCHER_PATH);
            },
            (_connection, _name) => {
                if (!this._started)
                    return;
                this.emit('name-acquired');
                this._dbusObject.emit_signal('StatusNotifierHostRegistered', null);
            },
            (_connection, _name) => {
                if (!this._started)
                    return;
                log('tray-quick-settings: org.kde.StatusNotifierWatcher is owned by another tray host');
                this.emit('name-busy');
            });
        this._ownIds.push(watcherId);

        this._ownIds.push(Gio.bus_own_name(
            Gio.BusType.SESSION, HOST_NAME, Gio.BusNameOwnerFlags.NONE,
            null, null, null));
    }

    stop() {
        if (!this._started)
            return;
        this._started = false;

        if (this._dbusObject) {
            this._dbusObject.unexport();
            this._dbusObject = null;
        }
        this._connection = null;
        for (const id of this._ownIds)
            Gio.bus_unown_name(id);
        this._ownIds = [];
        for (const id of this._watches.values())
            Gio.bus_unwatch_name(id);
        this._watches.clear();
        this._items = [];
    }

    // D-Bus: RegisterStatusNotifierItem(s). Async form to get the sender.
    RegisterStatusNotifierItemAsync(params, invocation) {
        const [service] = params;
        const {busName, objectPath} = parseService(service, invocation.get_sender());
        this._addItem(busName, objectPath);
        invocation.return_value(null);
    }

    RegisterStatusNotifierHost(_service) {
        // This watcher is its own host; nothing to track.
    }

    get RegisteredStatusNotifierItems() {
        return this.items;
    }

    get IsStatusNotifierHostRegistered() {
        return true;
    }

    get ProtocolVersion() {
        return 0;
    }

    _addItem(busName, objectPath) {
        const id = itemId(busName, objectPath);
        if (this._items.some(i => i.id === id))
            return;
        this._items.push({id, busName, objectPath});

        if (!this._watches.has(busName)) {
            this._watches.set(busName, Gio.bus_watch_name(
                Gio.BusType.SESSION, busName, Gio.BusNameWatcherFlags.NONE,
                null,
                () => this._busNameVanished(busName)));
        }

        this._dbusObject?.emit_signal('StatusNotifierItemRegistered',
            new GLib.Variant('(s)', [id]));
        this.emit('item-added', id, busName, objectPath);
    }

    _busNameVanished(busName) {
        const watchId = this._watches.get(busName);
        if (watchId !== undefined) {
            this._watches.delete(busName);
            Gio.bus_unwatch_name(watchId);
        }
        const gone = this._items.filter(i => i.busName === busName);
        this._items = this._items.filter(i => i.busName !== busName);
        for (const {id} of gone) {
            this._dbusObject?.emit_signal('StatusNotifierItemUnregistered',
                new GLib.Variant('(s)', [id]));
            this.emit('item-removed', id);
        }
    }
});
