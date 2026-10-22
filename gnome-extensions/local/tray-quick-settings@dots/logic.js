// Pure helpers for the tray: no Shell imports, testable under plain gjs.
import GLib from 'gi://GLib';

const DEFAULT_PATH = '/StatusNotifierItem';

// RegisterStatusNotifierItem argument: bus name, or object path (Electron).
export function parseService(service, sender) {
    if (service.startsWith('/'))
        return {busName: sender, objectPath: service};
    return {busName: service, objectPath: DEFAULT_PATH};
}

export function itemId(busName, objectPath) {
    return `${busName}${objectPath}`;
}

export function isAttention(status, iconName) {
    const name = iconName ?? '';
    if (name.includes('mute'))
        return false;
    return status === 'NeedsAttention' || name.includes('attention');
}

// Smallest pixmap not below `size`; otherwise the largest one.
export function pickPixmap(pixmaps, size) {
    if (!pixmaps || pixmaps.length === 0)
        return null;
    const sorted = [...pixmaps].sort((p, q) => p[0] - q[0]);
    return sorted.find(p => p[0] >= size) ?? sorted[sorted.length - 1];
}

// SNI pixmaps are ARGB32 big-endian; GdkPixbuf wants RGBA.
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

// DBusMenu mnemonics: '_X' marks a key, '__' is a literal underscore.
export function stripMnemonic(label) {
    return label.replace(/__|_/g, m => (m === '__' ? '_' : ''));
}

// Icon file in an app-provided IconThemePath; null if absent or the dir is gone.
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

// Runs attempt() up to 1 + retries times, awaiting wait() between tries. Resolves null as soon
// as keepGoing() is false after a failed try or a wait; otherwise rejects with the last error.
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
