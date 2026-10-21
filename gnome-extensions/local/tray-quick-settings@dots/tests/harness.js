import GLib from 'gi://GLib';

export const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

export function assert(cond, msg = 'assertion failed') {
    if (!cond)
        throw new Error(msg);
}

export function assertEqual(actual, expected, msg = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(`${msg ? `${msg}: ` : ''}expected ${b}, got ${a}`);
}

export async function assertRejects(promise) {
    try {
        await promise;
    } catch (e) {
        return;
    }
    throw new Error('expected promise to reject');
}

// Spin the GLib main context until predicate() is true.
export async function waitFor(predicate, timeoutMs = 3000) {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    const ctx = GLib.MainContext.default();
    while (!predicate()) {
        if (GLib.get_monotonic_time() > deadline)
            throw new Error(`waitFor timed out after ${timeoutMs} ms`);
        ctx.iteration(false);
        await new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        }));
    }
}
