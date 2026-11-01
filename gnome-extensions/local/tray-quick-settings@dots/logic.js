// Pure helpers for the tray: no Shell imports, testable under plain gjs.
import GLib from 'gi://GLib';

const DEFAULT_PATH = '/StatusNotifierItem';

/**
 * Splits a RegisterStatusNotifierItem argument: a bus name, or an object path
 * (Electron), whose bus name is then the sender.
 *
 * @param {string} service - the argument of the call
 * @param {string} sender - unique bus name of the caller
 * @returns {{busName: string, objectPath: string}}
 */
export function parseService(service, sender) {
    if (service.startsWith('/'))
        return {busName: sender, objectPath: service};
    return {busName: service, objectPath: DEFAULT_PATH};
}

/**
 * @param {string} busName
 * @param {string} objectPath
 * @returns {string} id of a tray item: bus name and object path together
 */
export function itemId(busName, objectPath) {
    return `${busName}${objectPath}`;
}

/**
 * Whether an app wants attention: NeedsAttention or an icon name with
 * "attention", never with "mute" (muted Telegram chats).
 *
 * @param {string} status - Status property of the item
 * @param {?string} iconName - IconName property of the item
 * @returns {boolean}
 */
export function isAttention(status, iconName) {
    const name = iconName ?? '';
    if (name.includes('mute'))
        return false;
    return status === 'NeedsAttention' || name.includes('attention');
}

/**
 * Smallest pixmap not below `size`; otherwise the largest one.
 *
 * @param {?Array<[number, number, Uint8Array]>} pixmaps - [width, height, ARGB32 data]
 * @param {number} size - wanted size in pixels
 * @returns {?[number, number, Uint8Array]}
 */
export function pickPixmap(pixmaps, size) {
    if (!pixmaps || pixmaps.length === 0)
        return null;
    const sorted = [...pixmaps].sort((p, q) => p[0] - q[0]);
    return sorted.find(p => p[0] >= size) ?? sorted[sorted.length - 1];
}

/**
 * SNI pixmaps are ARGB32 big-endian; GdkPixbuf wants RGBA.
 *
 * @param {Uint8Array} data - ARGB32 pixels
 * @returns {Uint8Array} RGBA pixels
 */
export function argbToRgba(data) {
    const out = new Uint8Array(data.length);
    for (let i = 0; i + 3 < data.length; i += 4) {
        out[i] = data[i + 1];
        out[i + 1] = data[i + 2];
        out[i + 2] = data[i + 3];
        out[i + 3] = data[i];
    }
    return out;
}

/**
 * DBusMenu mnemonics: '_X' marks a key, '__' is a literal underscore.
 *
 * @param {string} label - label with mnemonics
 * @returns {string} label without them
 */
export function stripMnemonic(label) {
    return label.replace(/__|_/g, m => (m === '__' ? '_' : ''));
}

/**
 * Icon file in an app-provided IconThemePath.
 *
 * @param {string} themePath - IconThemePath property of the item
 * @param {string} iconName - IconName property of the item
 * @returns {?string} path of the PNG or SVG file; null if absent or the dir is gone
 */
export function iconFileFor(themePath, iconName) {
    if (!themePath || !iconName)
        return null;
    for (const ext of ['png', 'svg']) {
        const file = `${themePath}/${iconName}.${ext}`;
        if (GLib.file_test(file, GLib.FileTest.EXISTS))
            return file;
    }
    return null;
}

/**
 * Runs attempt() up to 1 + retries times, awaiting wait() between tries.
 * Resolves null as soon as keepGoing() is false after a failed try or a wait;
 * otherwise rejects with the last error.
 *
 * @template T
 * @param {() => Promise<T>} attempt - one try
 * @param {object} options
 * @param {number} options.retries - tries after the first one
 * @param {() => Promise<void>} options.wait - pause between tries
 * @param {() => boolean} options.keepGoing - false stops the retries
 * @returns {Promise<?T>}
 */
export async function retry(attempt, {retries, wait, keepGoing}) {
    for (let i = 0; ; i++) {
        try {
            return await attempt();
        } catch (e) {
            if (!keepGoing())
                return null;
            if (i >= retries)
                throw e;
        }
        await wait();
        if (!keepGoing())
            return null;
    }
}
