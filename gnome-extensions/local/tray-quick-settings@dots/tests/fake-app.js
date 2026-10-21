// Standalone fake tray app for manual checks in a nested shell.
//   gjs -m tests/fake-app.js [--attention] [--count N] [--slow MS]
//       [--no-menu] [--broken-menu] [--empty-menu]
// --slow: item 1 answers Properties calls after MS (checks icon order vs registration order).
// --no-menu: item 1 has no Menu property; --broken-menu: its Menu path has no dbusmenu;
// --empty-menu: its dbusmenu has no entries.
// Menu: separator, disabled item, checkmark and radio items, a submenu, a hidden item.
// Clicking a checkmark/radio flips it (LayoutUpdated); "Quit" closes that item's connection.
// Item 2 (if N >= 2) is Electron-style: PNG in a temp IconThemePath, registered by path.
// stdin commands: a = toggle attention, p = toggle Passive, i = new Electron icon,
// m = change the menus (relabel + LayoutUpdated), q = quit.
// Registers again whenever org.kde.StatusNotifierWatcher appears; prints calls it receives.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GLibUnix from 'gi://GLibUnix';
import GioUnix from 'gi://GioUnix';
import GdkPixbuf from 'gi://GdkPixbuf';
import System from 'system';

import {makeFakeItem} from './fake-item.js';

const s = v => new GLib.Variant('s', v);

let attention = ARGV.includes('--attention');
const countArg = ARGV.indexOf('--count');
const count = countArg >= 0 ? Number(ARGV[countArg + 1]) : 2;
const slowArg = ARGV.indexOf('--slow');
const slowMs = slowArg >= 0 ? Number(ARGV[slowArg + 1]) : 0;
const noMenu = ARGV.includes('--no-menu');
const brokenMenu = ARGV.includes('--broken-menu');
const emptyMenu = ARGV.includes('--empty-menu');
let passive = false;
let menuSerial = 0;

const QUIT_ID = 3;
const mi = (id, props, children = []) => ({id, props, children});
const newMenu = () => mi(0, {}, [
    mi(1, {label: '_Open', type: 'standard', enabled: true}),
    mi(2, {type: 'separator'}),
    mi(4, {label: 'Disabled item', enabled: false}),
    mi(5, {label: 'Notifications', 'toggle-type': 'checkmark', 'toggle-state': 1}),
    mi(6, {label: 'Do not disturb', 'toggle-type': 'checkmark', 'toggle-state': 0}),
    mi(7, {type: 'separator'}),
    mi(8, {label: 'Online', 'toggle-type': 'radio', 'toggle-state': 1}),
    mi(9, {label: 'Away', 'toggle-type': 'radio', 'toggle-state': 0}),
    mi(10, {label: 'More', 'children-display': 'submenu'}, [
        mi(11, {label: 'About'}),
        mi(12, {label: 'Help', enabled: false}),
    ]),
    mi(13, {label: 'Hidden item', visible: false}),
    mi(14, {type: 'separator'}),
    mi(QUIT_ID, {label: 'Quit', type: 'standard', enabled: true}),
]);

function findNode(node, id) {
    if (node.id === id)
        return node;
    for (const c of node.children) {
        const found = findNode(c, id);
        if (found)
            return found;
    }
    return null;
}

function tooltip(title) {
    return new GLib.Variant('(sa(iiay)ss)', ['', [], title, '']);
}

function status() {
    if (passive)
        return 'Passive';
    return attention ? 'NeedsAttention' : 'Active';
}

// Vesktop-style icon: new temp dir and new file name on every change.
let pngSerial = 0;
let pngDir = null;
function newPng() {
    const oldDir = pngDir;
    pngDir = GLib.dir_make_tmp('fake-tray-XXXXXX');
    const name = `status_icon_${pngSerial++}`;
    const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 22, 22);
    pixbuf.fill(pngSerial % 2 ? 0x3d7fd6ff : 0xd63d3dff);
    pixbuf.savev(`${pngDir}/${name}.png`, 'png', [], []);
    if (oldDir)
        removeDir(oldDir);
    return {dir: pngDir, name};
}

function removeDir(dir) {
    GLib.unlink(`${dir}/${GLib.Dir.open(dir, 0).read_name()}`);
    GLib.rmdir(dir);
}

const items = [];
for (let i = 0; i < count; i++) {
    const electron = i === 1;
    let props;
    const menu = i === 0 && emptyMenu ? mi(0, {}) : newMenu();
    if (electron) {
        const png = newPng();
        props = {
            Id: s('fake-electron'), Title: s('Fake Electron'), Status: s(status()),
            IconThemePath: s(png.dir), IconName: s(png.name),
            ToolTip: tooltip('Fake Electron'),
            Menu: new GLib.Variant('o', '/MenuBar'), ItemIsMenu: new GLib.Variant('b', false),
        };
    } else {
        props = {
            Id: s(`fake-telegram-${i}`), Title: s(`Fake Telegram ${i}`), Status: s(status()),
            IconName: s(attention ? 'mail-unread-symbolic' : 'mail-read-symbolic'),
            ToolTip: tooltip(`Fake Telegram ${i}`),
            Menu: new GLib.Variant('o', '/MenuBar'), ItemIsMenu: new GLib.Variant('b', false),
        };
        if (i === 0 && noMenu)
            delete props.Menu;
        else if (i === 0 && brokenMenu)
            props.Menu = new GLib.Variant('o', '/NoSuchMenu');
    }
    const item = await makeFakeItem({
        props, menu, propsDelay: i === 0 ? slowMs : 0,
        register: electron ? 'path' : 'busName',
        objectPath: electron ? '/org/chromium/StatusNotifierItem/1' : '/StatusNotifierItem',
    });
    item.electron = electron;
    item.name = electron ? 'fake-electron' : `fake-telegram-${i}`;
    item.menu = menu;
    const calls = item.calls;
    calls.push = (...c) => {
        for (const {method, params} of c) {
            print(`call ${item.name} ${method} ${JSON.stringify(params)}`);
            if (method === 'Event' && params[1] === 'clicked')
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    onMenuClicked(item, params[0]);
                    return GLib.SOURCE_REMOVE;
                });
        }
        return Array.prototype.push.apply(calls, c);
    };
    print(`item ${item.name} ${item.uniqueName}${item.objectPath}`);
    items.push(item);
}

// One by one, so the watcher sees them in item order.
async function registerAll() {
    for (const item of items) {
        try {
            await item.register();
            print(`registered ${item.name}`);
        } catch (e) {
            print(`register ${item.name} failed: ${e.message}`);
        }
    }
}

// Register whenever the watcher appears, as real apps do.
const watchId = Gio.bus_watch_name_on_connection(items[0].connection,
    'org.kde.StatusNotifierWatcher', Gio.BusNameWatcherFlags.NONE,
    () => {
        print('watcher appeared');
        registerAll();
    },
    () => print('watcher vanished'));

function layoutUpdated(it) {
    it.emit('LayoutUpdated', [++menuSerial, 0]);
}

function onMenuClicked(it, id) {
    if (id === QUIT_ID) {
        print(`quit ${it.name}`);
        it.close();
        return;
    }
    const node = findNode(it.menu, id);
    const p = node?.props ?? {};
    if (p['toggle-type'] === 'checkmark') {
        p['toggle-state'] = p['toggle-state'] === 1 ? 0 : 1;
    } else if (p['toggle-type'] === 'radio') {
        for (const r of it.menu.children.filter(c => c.props['toggle-type'] === 'radio'))
            r.props['toggle-state'] = r === node ? 1 : 0;
    } else {
        return;
    }
    layoutUpdated(it);
}

function updateStatus() {
    for (const item of items) {
        item.setProp('Status', s(status()));
        if (!item.electron)
            item.setProp('IconName', s(attention ? 'mail-unread-symbolic' : 'mail-read-symbolic'));
        item.emit('NewStatus', new GLib.Variant('(s)', [status()]));
        item.emit('NewIcon');
    }
    print(`status ${status()}`);
}

const loop = new GLib.MainLoop(null, false);

function quit() {
    Gio.bus_unwatch_name(watchId);
    for (const item of items)
        item.close();
    if (pngDir)
        removeDir(pngDir);
    loop.quit();
}

const stdin = new Gio.DataInputStream({base_stream: new GioUnix.InputStream({fd: 0})});
function readLine() {
    stdin.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
        const [line] = stream.read_line_finish_utf8(res);
        if (line === null)
            return; // stdin closed: keep running until SIGINT
        if (line.trim() === 'q') {
            quit();
            return;
        }
        const cmd = line.trim();
        if (cmd === 'a') {
            attention = !attention;
            updateStatus();
        } else if (cmd === 'p') {
            passive = !passive;
            updateStatus();
        } else if (cmd === 'i') {
            const png = newPng();
            for (const item of items.filter(it => it.electron)) {
                item.setProp('IconThemePath', s(png.dir));
                item.setProp('IconName', s(png.name));
                item.emit('NewIcon');
            }
            print(`icon ${png.dir}/${png.name}.png`);
        } else if (cmd === 'm') {
            for (const it of items) {
                const open = findNode(it.menu, 1);
                if (!open)
                    continue; // --empty-menu
                open.props.label = `_Open ${menuSerial + 1}`;
                const dnd = findNode(it.menu, 6).props;
                dnd['toggle-state'] = dnd['toggle-state'] === 1 ? 0 : 1;
                layoutUpdated(it);
            }
            print(`menu ${menuSerial}`);
        }
        readLine();
    });
}
readLine();

for (const signum of [2, 15]) { // SIGINT, SIGTERM
    GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signum, () => {
        quit();
        return GLib.SOURCE_REMOVE;
    });
}

loop.run();
System.exit(0);
