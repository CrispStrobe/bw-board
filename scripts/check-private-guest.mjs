import {fileURLToPath} from 'node:url';
import {inspectPrivateGuest} from './lib/private-guest-fixtures.mjs';
try {
    if (process.argv.length > 3) throw new Error('usage: PRIVATE_DOS_FIXTURES=/external/path node scripts/check-private-guest.mjs [manifest.json]');
    console.log(JSON.stringify(inspectPrivateGuest({root:process.env.PRIVATE_DOS_FIXTURES,
        repository:fileURLToPath(new URL('..',import.meta.url)),manifest:process.argv[2] ?? 'manifest.json'})));
} catch (error) {console.error(error.message); process.exitCode=2;}
