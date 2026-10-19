import {createOwnedClockReplay} from '/tmp/bw-board-386-owned-clock-replay-20261002/scripts/bochs-cpu3-native-owned-clock-replay/factory.mjs';
try { await createOwnedClockReplay(); throw Error('missing assembler accepted'); }
catch (e) { if (!String(e).includes('ENOENT')) throw e; console.log('EXPECTED_STARTUP_REJECTION_AND_TIMER_CLEANUP'); }
