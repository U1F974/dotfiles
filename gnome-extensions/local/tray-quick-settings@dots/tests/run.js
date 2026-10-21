import GLib from 'gi://GLib';
import System from 'system';

import {tests} from './harness.js';

const dir = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);

const gdir = GLib.Dir.open(dir, 0);
const names = [];
let name;
while ((name = gdir.read_name()) !== null) {
    if (name.endsWith('.test.js'))
        names.push(name);
}
gdir.close();
names.sort();

const loop = new GLib.MainLoop(null, false);
let failed = 0;

async function main() {
    for (const file of names)
        await import(`./${file}`);

    for (const {name, fn} of tests) {
        try {
            await fn();
            print(`ok ${name}`);
        } catch (e) {
            failed++;
            print(`FAIL ${name}: ${e.message ?? e}`);
        }
    }
    print(`${tests.length - failed}/${tests.length} passed`);
}

main().catch(e => {
    failed++;
    print(`FAIL runner: ${e.message ?? e}\n${e.stack ?? ''}`);
}).finally(() => loop.quit());

loop.run();
System.exit(failed > 0 ? 1 : 0);
