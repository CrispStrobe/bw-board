// Acceptance against unmodified Microsoft MS-DOS 2.0 utilities.
//
// Unit programs written beside an emulator can accidentally share its
// assumptions. These binaries predate this project by decades. CI checks out
// their MIT-licensed upstream repository at an immutable commit and sets
// MSDOS_BIN_DIR, turning these tests from optional local evidence into a
// required real-software lane. Local installs without the binaries still get
// an explicit skip rather than a false pass.
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8086Machine} from '../src/i8086-machine.js';
import {createDos8086, DOSBOX8086} from '../src/i8086-dos.js';

const binDir = process.env.MSDOS_BIN_DIR || '/tmp/msdosbin';
const locate = (plain) => [plain, `v2.0_bin_${plain}`]
    .map((name) => join(binDir, name)).find(existsSync);
const debugPath = locate('DEBUG.COM');
const chkdskPath = locate('CHKDSK.COM');
const whenDebug = {skip: debugPath ? false : `MS-DOS 2.0 DEBUG.COM not found in ${binDir}`};
const whenChkdsk = {skip: chkdskPath ? false : `MS-DOS 2.0 CHKDSK.COM not found in ${binDir}`};

function runPeriodCom(path, typed = '') {
    const machine = new I8086Machine(DOSBOX8086);
    const dos = createDos8086(machine, {
        blockOnKey: true,
        dosVersion: {major: 2, minor: 0},
    }).install().loadCom(new Uint8Array(readFileSync(path)));
    if (typed) dos.type(typed);
    return {dos, run: dos.run(2_000_000)};
}

test('Microsoft DEBUG.COM executes, traces one instruction, and exits', whenDebug, () => {
    // Deposit two NOPs, ask DEBUG's real `t` command to execute exactly one,
    // then quit. The displayed IP and disassembly are external observations
    // of trap-flag ordering, not state read directly from our CPU object.
    const {dos, run} = runPeriodCom(debugPath, 'e 100 90 90 cc\rt=100 1\rq\r');
    assert.equal(run.exhausted, false, 'DEBUG completed within the instruction budget');
    assert.equal(run.terminated, true, 'DEBUG accepted q and returned to DOS');
    assert.match(dos.stdout, /IP=0101\s/);
    assert.match(dos.stdout, /:0101 90\s+NOP/);
});

test('Microsoft CHKDSK.COM passes its DOS 2.x version gate', whenChkdsk, () => {
    const {dos, run} = runPeriodCom(chkdskPath);
    assert.equal(run.exhausted, false, 'CHKDSK completed within the instruction budget');
    assert.equal(run.terminated, true);
    assert.match(dos.stdout, /Cannot CHDIR to root/);
    assert.doesNotMatch(dos.stdout, /Incorrect DOS version/);
});
