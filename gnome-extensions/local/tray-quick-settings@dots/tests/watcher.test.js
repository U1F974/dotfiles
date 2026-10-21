import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {test, assert, assertEqual, waitFor} from './harness.js';
import {makeFakeItem} from './fake-item.js';
import {Watcher} from '../sni/watcher.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');

const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';

function newConnection() {
    return Gio.DBusConnection.new_for_address_sync(
        GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
        Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
        Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
        null, null);
}

function track(w) {
    const t = {added: [], removed: [], busy: 0, acquired: 0};
    w.connect('item-added', (_, id) => t.added.push(id));
    w.connect('item-removed', (_, id) => t.removed.push(id));
    w.connect('name-busy', () => t.busy++);
    w.connect('name-acquired', () => t.acquired++);
    return t;
}

test('registers by bus name', async () => {
    const w = new Watcher();
    const t = track(w);
    w.start();
    await waitFor(() => t.acquired === 1);
    const f = await makeFakeItem({});
    try {
        await f.register();
        await waitFor(() => t.added.length === 1);
        assertEqual(t.added[0], `${f.uniqueName}/StatusNotifierItem`);
    } finally {
        f.close();
        w.stop();
    }
});

test('registers by object path (Electron)', async () => {
    const w = new Watcher();
    const t = track(w);
    w.start();
    await waitFor(() => t.acquired === 1);
    const f = await makeFakeItem({register: 'path', objectPath: '/org/chromium/StatusNotifierItem/1'});
    try {
        await f.register();
        await waitFor(() => t.added.length === 1);
        assertEqual(t.added[0], `${f.uniqueName}/org/chromium/StatusNotifierItem/1`);
    } finally {
        f.close();
        w.stop();
    }
});

test('duplicate registration is ignored', async () => {
    const w = new Watcher();
    const t = track(w);
    w.start();
    await waitFor(() => t.acquired === 1);
    const f = await makeFakeItem({});
    try {
        await f.register();
        await f.register();
        await waitFor(() => t.added.length >= 1);
        // Let a possible second emission arrive.
        await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            r();
            return GLib.SOURCE_REMOVE;
        }));
        assertEqual(t.added.length, 1);
        assertEqual(w.items.length, 1);
    } finally {
        f.close();
        w.stop();
    }
});

test('item removed when owner vanishes', async () => {
    const w = new Watcher();
    const t = track(w);
    w.start();
    await waitFor(() => t.acquired === 1);
    const f = await makeFakeItem({});
    try {
        await f.register();
        await waitFor(() => t.added.length === 1);
        f.close();
        await waitFor(() => t.removed.length === 1);
        assertEqual(t.removed[0], t.added[0]);
        assertEqual(w.items.length, 0);
    } finally {
        f.close();
        w.stop();
    }
});

test('RegisteredStatusNotifierItems property', async () => {
    const w = new Watcher();
    const t = track(w);
    w.start();
    await waitFor(() => t.acquired === 1);
    const f = await makeFakeItem({});
    const third = newConnection();
    try {
        await f.register();
        await waitFor(() => t.added.length === 1);
        const reply = await third.call(WATCHER_NAME, '/StatusNotifierWatcher',
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [WATCHER_NAME, 'RegisteredStatusNotifierItems']),
            null, Gio.DBusCallFlags.NONE, 2000, null);
        const value = reply.recursiveUnpack()[0];
        assertEqual(value, [`${f.uniqueName}/StatusNotifierItem`]);
    } finally {
        third.close_sync(null);
        f.close();
        w.stop();
    }
});

test('stop releases the name', async () => {
    const w = new Watcher();
    const t = track(w);
    w.start();
    await waitFor(() => t.acquired === 1);
    w.stop();
    const w2 = new Watcher();
    const t2 = track(w2);
    w2.start();
    try {
        await waitFor(() => t2.acquired === 1);
        assertEqual(t2.busy, 0);
    } finally {
        w2.stop();
    }
});

test('name-busy when owned elsewhere', async () => {
    const other = newConnection();
    let ownerAcquired = false;
    const id = Gio.bus_own_name_on_connection(other, WATCHER_NAME,
        Gio.BusNameOwnerFlags.NONE, () => (ownerAcquired = true), null);
    const w = new Watcher();
    const t = track(w);
    try {
        await waitFor(() => ownerAcquired);
        w.start();
        await waitFor(() => t.busy === 1);
        assertEqual(t.acquired, 0);
    } finally {
        w.stop();
        Gio.bus_unown_name(id);
        other.close_sync(null);
    }
});
