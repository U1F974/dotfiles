import GLib from 'gi://GLib';

import {test, assert, assertEqual} from './harness.js';
import {
    parseService, itemId, isAttention, pickPixmap, argbToRgba, stripMnemonic, iconFileFor,
} from '../logic.js';

const a = new Uint8Array([1]);
const b = new Uint8Array([2]);
const c = new Uint8Array([3]);

const dir = GLib.dir_make_tmp('tray-logic-XXXXXX');
GLib.file_set_contents(`${dir}/status_icon_1.png`, '');

test('parseService: bus name', () =>
    assertEqual(parseService(':1.5', ':1.5'), {busName: ':1.5', objectPath: '/StatusNotifierItem'}));
test('parseService: well-known name', () =>
    assertEqual(parseService('org.kde.foo', ':1.5'), {busName: 'org.kde.foo', objectPath: '/StatusNotifierItem'}));
test('parseService: object path (Electron)', () =>
    assertEqual(parseService('/org/chromium/StatusNotifierItem/1', ':1.9'),
        {busName: ':1.9', objectPath: '/org/chromium/StatusNotifierItem/1'}));
test('itemId', () => assertEqual(itemId(':1.9', '/StatusNotifierItem'), ':1.9/StatusNotifierItem'));
test('isAttention: status', () => assert(isAttention('NeedsAttention', 'app')));
test('isAttention: telegram icon', () => assert(isAttention('Active', 'org.telegram.desktop-attention-symbolic')));
test('isAttention: muted wins', () => assert(!isAttention('NeedsAttention', 'org.telegram.desktop-mute-symbolic')));
test('isAttention: plain', () => assert(!isAttention('Active', 'status_icon_1')));
test('pickPixmap: smallest not below size', () =>
    assertEqual(pickPixmap([[64, 64, a], [16, 16, b], [32, 32, c]], 24)[0], 32));
test('pickPixmap: largest when all smaller', () =>
    assertEqual(pickPixmap([[16, 16, b]], 48)[0], 16));
test('pickPixmap: empty', () => assertEqual(pickPixmap([], 16), null));
test('argbToRgba', () =>
    assertEqual([...argbToRgba(new Uint8Array([0x80, 1, 2, 3]))], [1, 2, 3, 0x80]));
test('stripMnemonic', () => assertEqual(stripMnemonic('_Quit __now'), 'Quit _now'));
test('iconFileFor: png in theme path', () =>
    assertEqual(iconFileFor(dir, 'status_icon_1'), `${dir}/status_icon_1.png`));
test('iconFileFor: missing file', () => assertEqual(iconFileFor(dir, 'nope'), null));
test('iconFileFor: deleted dir', () => assertEqual(iconFileFor('/tmp/does-not-exist-xyz', 'a'), null));
test('iconFileFor: empty path', () => assertEqual(iconFileFor('', 'a'), null));
