// Standalone fake tray app for manual checks in a nested shell.
//   gjs -m tests/fake-app.js [--attention] [--count N]
// Item 2 (if N >= 2) is Electron-style: PNG in a temp IconThemePath, registered by path.
// stdin commands: a = toggle attention, p = toggle Passive, i = new Electron icon, q = quit.
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
let passive = false;

const MENU = {
    id: 0, children: [
        {id: 1, props: {label: '_Open', type: 'standard', enabled: true}, children: []},
        {id: 2, props: {type: 'separator'}, children: []},
        {id: 3, props: {label: 'Quit', type: 'standard', enabled: true}, children: []},
    ],
};

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
    }
    const item = await makeFakeItem({
        props, menu: MENU,
        register: electron ? 'path' : 'busName',
        objectPath: electron ? '/org/chromium/StatusNotifierItem/1' : '/StatusNotifierItem',
    });
    item.electron = electron;
    item.name = electron ? 'fake-electron' : `fake-telegram-${i}`;
    const calls = item.calls;
    calls.push = (...c) => {
        for (const {method, params} of c)
            print(`call ${item.name} ${method} ${JSON.stringify(params)}`);
        return Array.prototype.push.apply(calls, c);
    };
    print(`item ${item.name} ${item.uniqueName}${item.objectPath}`);
    items.push(item);
}

// Register whenever the watcher appears, as real apps do.
const watchId = Gio.bus_watch_name_on_connection(items[0].connection,
    'org.kde.StatusNotifierWatcher', Gio.BusNameWatcherFlags.NONE,
    () => {
        print('watcher appeared');
        for (const item of items) {
            item.register()
                .then(() => print(`registered ${item.name}`))
                .catch(e => print(`register ${item.name} failed: ${e.message}`));
        }
    },
    () => print('watcher vanished'));

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
