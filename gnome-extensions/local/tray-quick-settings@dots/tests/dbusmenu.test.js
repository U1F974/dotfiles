import GLib from 'gi://GLib';

import {test, assert, assertEqual, assertRejects, waitFor} from './harness.js';
import {makeFakeItem, newConnection} from './fake-item.js';
import {DBusMenuClient} from '../sni/dbusmenu.js';

const TELEGRAM_MENU = () => ({
    id: 0,
    props: {'children-display': 'submenu'},
    children: [
        {id: 1, props: {label: '_Open Telegram'}},
        {id: 2, props: {type: 'separator'}},
        {id: 3, props: {label: 'Quit', enabled: false}},
        {id: 4, props: {label: 'Mute', 'toggle-type': 'checkmark', 'toggle-state': 1}},
        {id: 5, props: {label: 'More', 'children-display': 'submenu'}, children: [
            {id: 6, props: {label: 'A'}},
        ]},
    ],
});

async function setup(opts = {}) {
    const f = await makeFakeItem({menu: TELEGRAM_MENU(), ...opts});
    const conn = newConnection();
    const client = new DBusMenuClient(conn, f.uniqueName, '/MenuBar');
    const t = {changed: 0};
    client.connect('layout-changed', () => t.changed++);
    const cleanup = () => {
        client.destroy();
        conn.close_sync(null);
        f.close();
    };
    return {f, client, t, cleanup};
}

test('getLayout parses Telegram-like menu', async () => {
    const {client, cleanup} = await setup();
    try {
        const root = await client.getLayout();
        assertEqual(root.id, 0);
        assertEqual(root.children.map(c => [c.id, c.label, c.type, c.enabled]),
            [[1, 'Open Telegram', 'standard', true], [2, '', 'separator', true],
                [3, 'Quit', 'standard', false], [4, 'Mute', 'standard', true],
                [5, 'More', 'standard', true]]);
        assertEqual([root.children[3].toggleType, root.children[3].toggleState], ['checkmark', 1]);
        assertEqual([root.children[0].toggleType, root.children[0].toggleState, root.children[0].visible],
            ['', -1, true]);
        assertEqual(root.children[0].iconData, null);
        assertEqual(root.children[4].children[0].label, 'A');
    } finally {
        cleanup();
    }
});

test('activate sends clicked event', async () => {
    const {f, client, cleanup} = await setup();
    try {
        client.activate(1);
        await waitFor(() => f.calls.length);
        assertEqual([f.calls[0].method, f.calls[0].params[0], f.calls[0].params[1]], ['Event', 1, 'clicked']);
    } finally {
        cleanup();
    }
});

test('aboutToShow calls the method', async () => {
    const {f, client, cleanup} = await setup();
    try {
        await client.aboutToShow(5);
        assertEqual([f.calls[0].method, f.calls[0].params], ['AboutToShow', [5]]);
    } finally {
        cleanup();
    }
});

test('aboutToShow tolerates missing method', async () => {
    const {client, cleanup} = await setup({noAboutToShow: true});
    try {
        await client.aboutToShow(0);
    } finally {
        cleanup();
    }
});

test('LayoutUpdated emits layout-changed', async () => {
    const {f, t, cleanup} = await setup();
    try {
        f.emit('LayoutUpdated', [2, 0]);
        await waitFor(() => t.changed > 0);
    } finally {
        cleanup();
    }
});

test('ItemsPropertiesUpdated emits layout-changed', async () => {
    const {f, t, cleanup} = await setup();
    try {
        f.emit('ItemsPropertiesUpdated', [[], []]);
        await waitFor(() => t.changed > 0);
    } finally {
        cleanup();
    }
});

test('destroy stops layout-changed', async () => {
    const {f, client, t, cleanup} = await setup();
    try {
        client.destroy();
        f.emit('LayoutUpdated', [2, 0]);
        await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            r();
            return GLib.SOURCE_REMOVE;
        }));
        assertEqual(t.changed, 0);
    } finally {
        cleanup();
    }
});

test('getLayout rejects on silent menu', async () => {
    const {client, cleanup} = await setup({silent: true});
    try {
        await assertRejects(client.getLayout());
    } finally {
        cleanup();
    }
});
