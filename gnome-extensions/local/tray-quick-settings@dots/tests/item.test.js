import GLib from 'gi://GLib';

import {test, assert, assertEqual, assertRejects, waitFor} from './harness.js';
import {makeFakeItem, newConnection} from './fake-item.js';
import {TrayItem} from '../sni/item.js';

const s = v => new GLib.Variant('s', v);

function sleep(ms) {
    return new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        r();
        return GLib.SOURCE_REMOVE;
    }));
}

async function setup(props, opts = {}) {
    const f = await makeFakeItem({props, ...opts});
    const conn = newConnection();
    const it = await TrayItem.create(conn, f.uniqueName, f.objectPath);
    const t = {changed: 0};
    it.connect('changed', () => t.changed++);
    const cleanup = () => {
        it.destroy();
        conn.close_sync(null);
        f.close();
    };
    return {f, it, t, cleanup};
}

const TELEGRAM = () => ({
    Id: s('TelegramDesktop'),
    Status: s('Active'),
    IconName: s('org.telegram.desktop-symbolic'),
    Menu: new GLib.Variant('o', '/MenuBar'),
    ItemIsMenu: new GLib.Variant('b', false),
});

test('create reads Telegram-like props', async () => {
    const {f, it, cleanup} = await setup(TELEGRAM());
    try {
        assertEqual([it.id, it.status, it.menuPath, it.itemIsMenu, it.attention],
            ['TelegramDesktop', 'Active', '/MenuBar', false, false]);
        assertEqual([it.busName, it.objectPath], [f.uniqueName, '/StatusNotifierItem']);
    } finally {
        cleanup();
    }
});

test('missing props get defaults', async () => {
    const {it, cleanup} = await setup({});
    try {
        assertEqual([it.id, it.title, it.status, it.iconName, it.iconThemePath, it.menuPath,
            it.itemIsMenu, it.tooltipTitle, it.attentionIconName],
        ['', '', '', '', '', '', false, '', '']);
        assertEqual([it.iconPixmap, it.attentionIconPixmap], [[], []]);
    } finally {
        cleanup();
    }
});

test('pixmap and tooltip are read', async () => {
    const {it, cleanup} = await setup({
        IconPixmap: new GLib.Variant('a(iiay)', [[1, 1, [1, 2, 3, 4]]]),
        ToolTip: new GLib.Variant('(sa(iiay)ss)', ['', [], 'Tip title', 'body']),
    });
    try {
        assertEqual(it.iconPixmap.length, 1);
        assertEqual([it.iconPixmap[0][0], it.iconPixmap[0][1]], [1, 1]);
        assertEqual(Array.from(it.iconPixmap[0][2]), [1, 2, 3, 4]);
        assertEqual(it.tooltipTitle, 'Tip title');
    } finally {
        cleanup();
    }
});

test('NewIcon refreshes and emits changed', async () => {
    const {f, it, t, cleanup} = await setup(TELEGRAM());
    try {
        f.setProp('IconName', s('org.telegram.desktop-attention-symbolic'));
        f.emit('NewIcon');
        await waitFor(() => t.changed > 0);
        assert(it.attention);
    } finally {
        cleanup();
    }
});

test('NewIconThemePath (Vesktop) refreshes path and name', async () => {
    const {f, it, t, cleanup} = await setup({
        IconThemePath: s('/tmp/old'), IconName: s('status_icon_1'),
    });
    try {
        f.setProp('IconThemePath', s('/tmp/new'));
        f.setProp('IconName', s('status_icon_2'));
        f.emit('NewIconThemePath');
        await waitFor(() => t.changed > 0);
        assertEqual([it.iconThemePath, it.iconName], ['/tmp/new', 'status_icon_2']);
    } finally {
        cleanup();
    }
});

test('burst of signals is coalesced', async () => {
    const {f, t, cleanup} = await setup(TELEGRAM());
    try {
        for (let i = 0; i < 5; i++)
            f.emit('NewIcon');
        await waitFor(() => t.changed > 0);
        await sleep(200);
        assert(t.changed <= 2, `changed ${t.changed} times`);
    } finally {
        cleanup();
    }
});

test('activate passes coordinates', async () => {
    const {f, it, cleanup} = await setup(TELEGRAM());
    try {
        it.activate(10, 20);
        await waitFor(() => f.calls.length);
        assertEqual(f.calls[0], {method: 'Activate', params: [10, 20]});
    } finally {
        cleanup();
    }
});

test('secondaryActivate and contextMenu pass coordinates', async () => {
    const {f, it, cleanup} = await setup(TELEGRAM());
    try {
        it.secondaryActivate(1, 2);
        it.contextMenu(3, 4);
        await waitFor(() => f.calls.length === 2);
        assertEqual(f.calls.map(c => c.method).sort(), ['ContextMenu', 'SecondaryActivate']);
    } finally {
        cleanup();
    }
});

test('scroll passes delta and orientation', async () => {
    const {f, it, cleanup} = await setup(TELEGRAM());
    try {
        it.scroll(-1, 'vertical');
        await waitFor(() => f.calls.length);
        assertEqual(f.calls[0].params, [-1, 'vertical']);
    } finally {
        cleanup();
    }
});

test('create rejects on silent item', async () => {
    const f = await makeFakeItem({silent: true});
    const conn = newConnection();
    try {
        await assertRejects(TrayItem.create(conn, f.uniqueName, f.objectPath));
    } finally {
        conn.close_sync(null);
        f.close();
    }
});

test('create rejects on missing object', async () => {
    const f = await makeFakeItem({});
    const conn = newConnection();
    try {
        await assertRejects(TrayItem.create(conn, f.uniqueName, '/nope'));
    } finally {
        conn.close_sync(null);
        f.close();
    }
});

test('destroy stops changed', async () => {
    const {f, it, t, cleanup} = await setup(TELEGRAM());
    try {
        it.destroy();
        f.emit('NewIcon');
        await sleep(200);
        assertEqual(t.changed, 0);
    } finally {
        cleanup();
    }
});
