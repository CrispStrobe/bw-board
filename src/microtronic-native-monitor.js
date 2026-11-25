// SPDX-License-Identifier: MIT
import {assembleTms1600} from './tms1600-assembler.js';

// All monitor decisions run in the assembled TMS1600 instruction stream.
// Each native block occupies one LFSR page. The linker resolves cross-page
// and cross-chapter destinations before passing sections to the assembler.
const blocks = [];
let block;

function section(name, build, origin) {
  block = {name, code: [], origin};
  blocks.push(block);
  block.code.push(name + ':');
  build();
}

function ins(...instructions) { block.code.push(...instructions); }
function label(name) { ins(block.name + '_' + name + ':'); }
function br(name) { ins(['BR', block.name + '_' + name]); }
function jump(name) { ins({transfer: 'BR', name}); }
function call(name) { ins({transfer: 'CALL', name}); }
function on(test, target) {
  const index = block.code.length;
  ins(...test);
  br('take_' + index);
  br('skip_' + index);
  label('take_' + index);
  jump(target);
  label('skip_' + index);
}
function equal(value, target) {
  const index = block.code.length;
  ins(['TCY', value], 'YNEA');
  br('different_' + index);
  jump(target);
  label('different_' + index);
}

// X bank 0 holds the visible monitor state. X bank 1 holds interpreter
// temporaries, banks 2 and 3 hold the guest working and memory registers.
const PCLO = 0, PCHI = 1, FLAGS = 2, DOT = 3, DIGITS = 4, START = 5;
const KIND = 6, KEY = 7, LOCK = 8, MODE = 9, HIGH = 10, BPLO = 11, BPHI = 12;
const RUN = 13, SKIP = 14, EDIT = 15;
const OP = 0, ARG = 1, REG = 2, SRC = 3, DST = 4, RESULT = 5, SLOT = 6, COUNT = 7;
const E0 = 8, E1 = 9, E2 = 10, CE = 11, LINKLO = 12, LINKHI = 13, VIEW = 14, WAIT = 15;
const BROWSE = 0, HALTED = 1, ADDRHI = 2, ADDRLO = 3, REGSEL = 4, REGEDIT = 5;
const BREAKHI = 6, BREAKLO = 7, PROGRAM = 8, CLOCK_ENTRY = 9;
const ADDRESS_VIEW = 0, DARK_VIEW = 1, LIVE_VIEW = 2, REGISTER_VIEW = 3, CLOCK_VIEW = 4;
const CLOCK_INPUT = 6, CLOCK_SLOT = 7, LIMITATION = 8, RANDOM = 9, RANDOM_STEPS = 12, CLOCK_SAMPLE = 13;
const KEY_HEX = 1, KEY_FUNCTION = 2, RUN_CONTINUOUS = 1, RUN_STEP = 2;

function at(x, y) { ins(['LDX', x], ['TCY', y]); }
function read(x, y) { at(x, y); ins('TMA'); }
function write(x, y) { at(x, y); ins('TAM'); }
function set(x, y, value) { at(x, y); ins(['TCMIY', value]); }
function copy(sx, sy, dx, dy) { read(sx, sy); write(dx, dy); }
function flag(bit, enabled) { at(0, FLAGS); ins([enabled ? 'SBIT' : 'RBIT', bit]); }
function pulse(r) { at(0, r); ins('SETR', 'RSTR'); }
function inPin(r) { at(0, r); ins('SETR', 'TKA', 'RSTR'); }
function outPin(r) { ins('TDO', ['TCY', r], 'SETR', 'RSTR'); }
function display(n, special = false) {
  if (special) {
    ins(['TCY', 15], 'CLA', 'YNEA');
    if (n) ins(['AC1AC', 0]);
  } else ins(['TCY', n], 'TYA', 'YNEA');
  outPin(11);
}
function position(n) {
  ins(['TCY', n], 'TYA', 'YNEA');
  outPin(10);
}
function displayA() { ins('TAY', 'YNEA'); outPin(11); }
function displayRam(x, y) { read(x, y); displayA(); }
function bankZero(x) {
  ins(['LDX', x], ['TCY', 15], 'CLA');
  label('clear' + x);
  ins('TAMDYN');
  br('clear' + x);
}

section('boot', () => {
  call('clearBanks');
  jump('bootPins');
}, {chapter: 0, page: 15});

section('clearBanks', () => {
  bankZero(0);
  bankZero(1);
  bankZero(2);
  bankZero(3);
  bankZero(4);
  bankZero(5);
  bankZero(7);
  ins('RETN');
});

section('bootPins', () => {
  inPin(2);
  write(7, CLOCK_INPUT);
  set(7, RANDOM, 1);
  ins(['LDX', 0]);
  ins('CLA', ['TCY', 0], 'YNEA');
  outPin(3);
  jump('main');
});

section('main', () => {
  call('sampleClock');
  call('frame');
  call('scan');
  at(0, KIND);
  ins('MNEZ');
  br('event');
  at(0, RUN);
  ins('MNEZ');
  br('active');
  jump('main');
  label('active');
  at(1, WAIT);
  ins('MNEZ');
  br('idle');
  jump('beginGuest');
  label('event');
  set(7, LIMITATION, 0);
  read(0, KIND);
  equal(KEY_FUNCTION, 'functionKey');
  jump('hexKey');
  label('idle');
  jump('main');
});

section('scan', () => {
  set(0, KIND, 0);
  inPin(1);
  ins(['TCY', 0], 'YNEA');
  br('held');
  set(0, LOCK, 0);
  ins('RETN');
  label('held');
  at(0, LOCK);
  ins('MNEZ');
  br('done');
  write(0, KIND);
  set(0, LOCK, 1);
  inPin(0);
  write(0, KEY);
  label('done');
  ins('RETN');
});

section('frame', () => {
  read(1, VIEW);
  equal(DARK_VIEW, 'darkFrame');
  equal(LIVE_VIEW, 'liveFrame');
  equal(REGISTER_VIEW, 'registerFrame');
  equal(CLOCK_VIEW, 'clockFrame');
  jump('addressFrame');
});

section('addressFrame', () => {
  call('fetch');
  position(0);
  displayRam(0, PCHI);
  position(1);
  displayRam(0, PCLO);
  position(2);
  display(0, true);
  jump('addressWord');
});

section('addressWord', () => {
  position(3);
  displayRam(1, OP);
  position(4);
  displayRam(1, ARG);
  position(5);
  displayRam(1, REG);
  jump('frameStatus');
});

section('darkFrame', () => {
  set(1, SLOT, 0);
  label('digit');
  read(1, SLOT);
  ins('TAY', 'YNEA');
  outPin(10);
  display(0, true);
  at(1, SLOT);
  ins('IMAC', 'TAM', ['TCY', 6], 'YNEA');
  br('digit');
  jump('frameStatus');
});

section('liveFrame', () => {
  set(1, SLOT, 5);
  copy(0, DIGITS, 1, COUNT);
  copy(0, START, 1, RESULT);
  jump('liveDigits');
});

section('liveDigits', () => {
  label('digit');
  read(1, SLOT);
  ins('TAY', 'YNEA');
  outPin(10);
  at(1, COUNT);
  ins('MNEZ');
  br('live');
  display(0, true);
  br('advance');
  label('live');
  ins('OMAN', 'TAM');
  read(1, RESULT);
  ins(['LDX', 2], 'TAY', 'TMA');
  displayA();
  at(1, RESULT);
  ins('IMAC', 'TAM');
  label('advance');
  at(1, SLOT);
  ins('OMAN', 'TAM', ['TCY', 15], 'YNEA');
  br('digit');
  jump('frameStatus');
});

section('registerFrame', () => {
  position(0); display(1, true);
  position(1); display(1, true);
  position(2); displayRam(0, HIGH);
  jump('registerValue');
});

section('registerValue', () => {
  position(3); display(1, true);
  position(4); display(1, true);
  position(5);
  read(0, HIGH);
  ins(['LDX', 2], 'TAY', 'TMA');
  displayA();
  jump('frameStatus');
});

section('frameStatus', () => {
  read(0, FLAGS);
  ins('TAY', 'YNEA');
  outPin(12);
  at(0, RUN);
  ins('MNEZ');
  br('active');
  ins('CLA');
  br('wait');
  label('active');
  ins('CLA', ['AC1AC', 0]);
  label('wait');
  at(1, WAIT);
  ins('MNEZ');
  br('waiting');
  br('emit');
  label('waiting');
  ins(['AC1AC', 1]);
  label('emit');
  at(7, LIMITATION);
  ins('MNEZ');
  br('limitation');
  br('publish');
  label('limitation');
  ins(['AC1AC', 3]);
  label('publish');
  ins(['LDX', 0], 'TAY', 'YNEA');
  outPin(13);
  pulse(14);
  ins('RETN');
});

section('addressBus', () => {
  read(0, PCHI);
  ins('TAY', 'YNEA');
  outPin(4);
  read(0, PCLO);
  ins('TAY', 'YNEA');
  outPin(5);
  ins('RETN');
});

section('fetch', () => {
  call('addressBus');
  for (let i = 0; i < 3; i++) {
    inPin(6 + i);
    write(1, OP + i);
  }
  at(0, EDIT);
  ins('MNEZ');
  br('preview');
  ins('RETN');
  label('preview');
  read(0, EDIT);
  equal(1, 'previewOne');
  equal(2, 'previewTwo');
  copy(1, E2, 1, REG);
  jump('previewTwo');
});

section('previewTwo', () => {
  copy(1, E1, 1, ARG);
  jump('previewOne');
});

section('previewOne', () => {
  copy(1, E0, 1, OP);
  ins('RETN');
});

section('store', () => {
  call('addressBus');
  at(0, 9);
  ins('SETR');
  for (let i = 0; i < 3; i++) {
    read(1, OP + i);
    ins('TAY', 'YNEA');
    outPin(6 + i);
  }
  at(0, 9);
  ins('RSTR', 'RETN');
});

section('increment', () => {
  at(0, PCLO);
  ins('IMAC', 'TAM', ['TCY', 0], 'YNEA');
  br('done');
  at(0, PCHI);
  ins('IMAC', 'TAM');
  label('done');
  ins('RETN');
});

section('functionKey', () => {
  read(0, KEY);
  equal(0, 'resetKey');
  equal(1, 'haltKey');
  at(0, RUN);
  ins('MNEZ');
  br('busy');
  read(0, KEY);
  equal(2, 'nextKey');
  equal(3, 'ceKey');
  equal(4, 'runKey');
  equal(5, 'stepKey');
  jump('functionKeyMore');
  label('busy');
  jump('main');
});

section('functionKeyMore', () => {
  equal(6, 'regKey');
  equal(7, 'breakKey');
  equal(8, 'programKey');
  jump('main');
});

section('resetKey', () => {
  call('clearBanks');
  set(0, LOCK, 1);
  jump('bootPins');
});

section('haltKey', () => {
  set(0, RUN, 0);
  set(1, WAIT, 0);
  set(0, EDIT, 0);
  set(1, CE, 0);
  set(0, MODE, HALTED);
  set(1, VIEW, ADDRESS_VIEW);
  jump('main');
});

section('nextKey', () => {
  read(0, MODE);
  equal(HALTED, 'selectAddress');
  at(0, EDIT);
  ins('TMA', ['TCY', 3], 'YNEA');
  br('advance');
  copy(1, E0, 1, OP);
  copy(1, E1, 1, ARG);
  copy(1, E2, 1, REG);
  call('store');
  label('advance');
  set(0, EDIT, 0);
  set(1, CE, 0);
  set(0, MODE, BROWSE);
  set(1, VIEW, ADDRESS_VIEW);
  call('increment');
  jump('main');
});

section('ceKey', () => {
  at(1, CE);
  ins('MNEZ');
  br('clear');
  at(0, EDIT);
  ins('MNEZ');
  br('remove');
  jump('main');
  label('remove');
  ins('OMAN', 'TAM');
  set(1, CE, 1);
  jump('main');
  label('clear');
  set(0, EDIT, 0);
  jump('main');
});

section('selectAddress', () => {
  set(0, MODE, ADDRHI);
  jump('main');
});

section('regKey', () => {
  set(0, MODE, REGSEL);
  set(0, EDIT, 0);
  jump('main');
});

section('breakKey', () => {
  set(0, MODE, BREAKHI);
  set(0, EDIT, 0);
  jump('main');
});

section('programKey', () => {
  set(0, MODE, PROGRAM);
  set(0, EDIT, 0);
  jump('main');
});

section('runKey', () => {
  set(0, RUN, RUN_CONTINUOUS);
  set(0, MODE, BROWSE);
  set(0, EDIT, 0);
  set(1, VIEW, DARK_VIEW);
  jump('beginGuest');
});

section('stepKey', () => {
  set(0, RUN, RUN_STEP);
  set(0, MODE, BROWSE);
  set(0, EDIT, 0);
  set(1, VIEW, ADDRESS_VIEW);
  jump('beginGuest');
});

section('hexKey', () => {
  at(1, WAIT);
  ins('MNEZ');
  br('kin');
  at(0, RUN);
  ins('MNEZ');
  br('busy');
  read(0, MODE);
  equal(ADDRHI, 'addressHigh');
  equal(ADDRLO, 'addressLow');
  equal(REGSEL, 'registerSelect');
  jump('hexKeyMore');
  label('kin');
  jump('kinValue');
  label('busy');
  jump('main');
});

section('hexKeyMore', () => {
  equal(REGEDIT, 'registerEdit');
  equal(BREAKHI, 'breakHigh');
  equal(BREAKLO, 'breakLow');
  equal(PROGRAM, 'programSelect');
  equal(CLOCK_ENTRY, 'clockEdit');
  jump('editWord');
});

section('addressHigh', () => {
  copy(0, KEY, 0, HIGH);
  set(0, MODE, ADDRLO);
  jump('main');
});

section('addressLow', () => {
  copy(0, HIGH, 0, PCHI);
  copy(0, KEY, 0, PCLO);
  set(0, SKIP, 0);
  set(0, MODE, BROWSE);
  jump('main');
});

section('registerSelect', () => {
  copy(0, KEY, 0, HIGH);
  set(0, MODE, REGEDIT);
  set(1, VIEW, REGISTER_VIEW);
  jump('main');
});

section('registerEdit', () => {
  read(0, HIGH);
  write(1, RESULT);
  read(0, KEY);
  at(1, RESULT);
  ins('TMY', ['LDX', 2], 'TAM');
  jump('main');
});

section('breakHigh', () => {
  copy(0, KEY, 0, HIGH);
  set(0, MODE, BREAKLO);
  jump('main');
});

section('breakLow', () => {
  copy(0, HIGH, 0, BPHI);
  copy(0, KEY, 0, BPLO);
  set(0, SKIP, 0);
  set(0, MODE, BROWSE);
  jump('main');
});

section('editWord', () => {
  set(1, CE, 0);
  at(0, EDIT);
  ins('TMA', ['TCY', 3], 'YNEA');
  br('append');
  jump('main');
  label('append');
  ins(['AC1AC', E0 - 1]);
  write(1, SLOT);
  read(0, KEY);
  at(1, SLOT);
  ins('TMY', 'TAM');
  at(0, EDIT);
  ins('IMAC', 'TAM');
  set(0, MODE, BROWSE);
  jump('main');
});

section('programSelect', () => {
  set(0, MODE, BROWSE);
  read(0, KEY);
  equal(3, 'clockSet');
  equal(4, 'clockShow');
  equal(5, 'fillZero');
  equal(6, 'fillNop');
  set(7, LIMITATION, 1);
  jump('main');
});

section('fillZero', () => {
  set(1, OP, 0);
  set(1, ARG, 0);
  set(1, REG, 0);
  jump('fill');
});

section('fillNop', () => {
  set(1, OP, 15);
  set(1, ARG, 0);
  set(1, REG, 1);
  jump('fill');
});

section('fill', () => {
  set(0, PCLO, 0);
  set(0, PCHI, 0);
  label('word');
  call('store');
  call('increment');
  at(0, PCLO);
  ins('MNEZ');
  br('word');
  at(0, PCHI);
  ins('MNEZ');
  br('word');
  jump('main');
});

section('beginGuest', () => {
  read(0, RUN);
  ins(['TCY', RUN_CONTINUOUS], 'YNEA');
  br('go');
  jump('runGate');
  label('go');
  jump('decode');
});

section('runGate', () => {
  // R0 and R15 together select the virtual board's RUN clock token.
  // A pulse on R15 alone is the retirement event.
  at(0, 0);
  ins('SETR', ['TCY', 15], 'SETR', 'TKA', 'RSTR', ['TCY', 0], 'RSTR', 'YNEA');
  br('clock');
  jump('main');
  label('clock');
  jump('checkBreakpoint');
});

section('checkBreakpoint', () => {
  at(0, SKIP);
  ins('MNEZ');
  br('resume');
  at(0, BPLO);
  ins('MNEZ');
  br('match');
  at(0, BPHI);
  ins('MNEZ');
  br('match');
  br('go');
  label('match');
  read(0, PCLO);
  at(0, BPLO);
  ins('MNEA');
  br('go');
  read(0, PCHI);
  at(0, BPHI);
  ins('MNEA');
  br('go');
  set(0, SKIP, 1);
  set(0, RUN, 0);
  set(1, VIEW, ADDRESS_VIEW);
  jump('main');
  label('resume');
  set(0, SKIP, 0);
  label('go');
  jump('decode');
});

section('decode', () => {
  call('fetch');
  read(1, OP);
  equal(15, 'decodeExtended');
  equal(14, 'branchZero');
  equal(13, 'branchCarry');
  equal(12, 'guestJump');
  equal(11, 'guestCall');
  jump('decodeOrdinary');
});

section('branchZero', () => {
  at(0, FLAGS);
  ins(['TBIT1', 1]);
  br('taken');
  jump('advanceGuest');
  label('taken');
  jump('guestJump');
});

section('branchCarry', () => {
  at(0, FLAGS);
  ins(['TBIT1', 0]);
  br('taken');
  jump('advanceGuest');
  label('taken');
  jump('guestJump');
});

section('guestCall', () => {
  call('increment');
  copy(0, PCLO, 1, LINKLO);
  copy(0, PCHI, 1, LINKHI);
  jump('guestJump');
});

section('guestJump', () => {
  copy(1, ARG, 0, PCHI);
  copy(1, REG, 0, PCLO);
  jump('endGuest');
});

section('guestReturn', () => {
  copy(1, LINKLO, 0, PCLO);
  copy(1, LINKHI, 0, PCHI);
  jump('endGuest');
});

section('decodeOrdinary', () => {
  read(1, REG);
  ins(['LDX', 2], 'TAY', 'TMA');
  write(1, DST);
  at(1, OP);
  ins(['TBIT1', 0]);
  br('immediate');
  read(1, ARG);
  ins(['LDX', 2], 'TAY', 'TMA');
  br('source');
  label('immediate');
  read(1, ARG);
  label('source');
  write(1, SRC);
  jump('ordinaryOperation');
});

section('ordinaryOperation', () => {
  read(1, OP);
  equal(10, 'aluOr');
  at(1, OP);
  ins(['TBIT1', 3]);
  br('compare');
  ins(['TBIT1', 2]);
  br('arithmetic');
  ins(['TBIT1', 1]);
  br('logic');
  jump('aluMove');
  label('compare');
  jump('aluCompare');
  label('arithmetic');
  ins(['TBIT1', 1]);
  br('subtract');
  jump('aluAdd');
  label('subtract');
  jump('aluSubtract');
  label('logic');
  jump('aluAnd');
});

section('aluMove', () => {
  read(1, SRC);
  jump('writeResult');
});

section('aluAdd', () => {
  flag(0, false);
  read(1, SRC);
  at(1, DST);
  ins('AMAAC');
  br('carry');
  jump('writeResult');
  label('carry');
  flag(0, true);
  jump('writeResult');
});

section('aluSubtract', () => {
  flag(0, false);
  read(1, SRC);
  at(1, DST);
  ins('SAMAN');
  br('result');
  flag(0, true);
  label('result');
  jump('writeResult');
});

section('aluCompare', () => {
  flag(0, false);
  flag(1, false);
  read(1, SRC);
  at(1, DST);
  ins('MNEA');
  br('different');
  flag(1, true);
  jump('advanceGuest');
  label('different');
  at(1, DST);
  ins('ALEM');
  br('less');
  jump('advanceGuest');
  label('less');
  flag(0, true);
  jump('advanceGuest');
});

section('aluAnd', () => {
  set(1, RESULT, 0);
  for (let bit = 0; bit < 4; bit++) {
    at(1, SRC);
    ins(['TBIT1', bit]);
    br('source' + bit);
    br('next' + bit);
    label('source' + bit);
    at(1, DST);
    ins(['TBIT1', bit]);
    br('set' + bit);
    br('next' + bit);
    label('set' + bit);
    at(1, RESULT);
    ins(['SBIT', bit]);
    label('next' + bit);
  }
  jump('logicalResult');
});

section('aluOr', () => {
  copy(1, DST, 1, RESULT);
  for (let bit = 0; bit < 4; bit++) {
    at(1, SRC);
    ins(['TBIT1', bit]);
    br('set' + bit);
    br('next' + bit);
    label('set' + bit);
    at(1, RESULT);
    ins(['SBIT', bit]);
    label('next' + bit);
  }
  jump('logicalResult');
});

section('logicalResult', () => {
  flag(0, false);
  read(1, RESULT);
  jump('writeResult');
});

section('writeResult', () => {
  at(1, REG);
  ins('TMY', ['LDX', 2], 'TAM');
  jump('resultFlags');
});

section('resultFlags', () => {
  flag(1, false);
  ins(['TCY', 0], 'YNEA');
  br('advance');
  flag(1, true);
  label('advance');
  jump('advanceGuest');
});

section('advanceGuest', () => {
  call('increment');
  jump('endGuest');
});

section('endGuest', () => {
  set(0, SKIP, 0);
  read(0, RUN);
  ins(['TCY', RUN_STEP], 'YNEA');
  br('boundary');
  set(0, RUN, 0);
  label('boundary');
  pulse(15);
  jump('main');
});

section('decodeExtended', () => {
  read(1, ARG);
  equal(0, 'decodeSpecial');
  equal(7, 'memorySave');
  equal(8, 'invert');
  equal(9, 'shiftRight');
  equal(10, 'shiftLeft');
  jump('decodeExtendedMore');
});

section('decodeExtendedMore', () => {
  equal(11, 'addCarry');
  equal(12, 'subtractCarry');
  equal(13, 'guestInput');
  equal(14, 'guestOutput');
  equal(15, 'guestKeyboard');
  jump('guestDisplay');
});

function workingA() { read(1, REG); ins(['LDX', 2], 'TAY', 'TMA'); }

section('guestDisplay', () => {
  copy(1, ARG, 0, DIGITS);
  copy(1, REG, 0, START);
  set(1, VIEW, LIVE_VIEW);
  jump('advanceGuest');
});

section('memorySave', () => {
  workingA();
  ins(['LDX', 3], 'TAM');
  jump('advanceGuest');
});

section('invert', () => {
  flag(0, false);
  workingA();
  ins('CPAIZ', ['AC1AC', 14]);
  jump('writeResult');
});

section('shiftLeft', () => {
  flag(0, false);
  workingA();
  write(1, DST);
  ins('AMAAC');
  br('carry');
  jump('writeResult');
  label('carry');
  flag(0, true);
  jump('writeResult');
});

section('shiftRight', () => {
  flag(0, false);
  workingA();
  write(1, DST);
  ins(['TBIT1', 0]);
  br('carry');
  br('shift');
  label('carry');
  flag(0, true);
  label('shift');
  set(1, RESULT, 0);
  for (let bit = 1; bit < 4; bit++) {
    at(1, DST);
    ins(['TBIT1', bit]);
    br('copy' + bit);
    br('skip' + bit);
    label('copy' + bit);
    at(1, RESULT);
    ins(['SBIT', bit - 1]);
    label('skip' + bit);
  }
  read(1, RESULT);
  jump('writeResult');
});

section('addCarry', () => {
  at(0, FLAGS);
  ins(['TBIT1', 0]);
  br('adding');
  workingA();
  jump('writeResult');
  label('adding');
  flag(0, false);
  workingA();
  ins(['AC1AC', 0]);
  br('carry');
  jump('writeResult');
  label('carry');
  flag(0, true);
  jump('writeResult');
});

section('subtractCarry', () => {
  at(0, FLAGS);
  ins(['TBIT1', 0]);
  br('subtracting');
  workingA();
  jump('writeResult');
  label('subtracting');
  flag(0, false);
  workingA();
  ins(['TCY', 0], 'YNEA');
  br('result');
  flag(0, true);
  label('result');
  ins(['AC1AC', 14]);
  jump('writeResult');
});

section('guestInput', () => {
  flag(0, false);
  inPin(2);
  jump('writeResult');
});

section('guestOutput', () => {
  flag(0, false);
  workingA();
  write(0, DOT);
  ins('TAY', 'YNEA');
  outPin(3);
  jump('resultFlags');
});

section('guestKeyboard', () => {
  set(1, WAIT, 1);
  jump('main');
});

section('kinValue', () => {
  set(1, WAIT, 0);
  flag(0, false);
  read(0, KEY);
  jump('writeResult');
});

section('decodeSpecial', () => {
  read(1, REG);
  equal(0, 'guestHalt');
  equal(2, 'guestDark');
  equal(7, 'guestReturn');
  equal(8, 'guestClear');
  equal(9, 'carrySet');
  equal(10, 'carryReset');
  jump('decodeSpecialMore');
});

section('decodeSpecialMore', () => {
  read(1, REG);
  equal(3, 'convertToDecimal');
  equal(4, 'convertToHex');
  equal(5, 'guestRandom');
  equal(6, 'guestTime');
  equal(11, 'decimalMultiply');
  equal(12, 'decimalDivide');
  jump('decodeExchanges');
});

section('decodeExchanges', () => {
  equal(13, 'exchangeLow');
  equal(14, 'exchangeHigh');
  equal(15, 'exchangeWorking');
  jump('advanceGuest');
});

section('guestHalt', () => {
  read(0, RUN);
  equal(RUN_STEP, 'advanceGuest');
  set(0, RUN, 0);
  set(1, VIEW, ADDRESS_VIEW);
  jump('endGuest');
});

section('guestDark', () => {
  read(0, RUN);
  equal(RUN_STEP, 'advanceGuest');
  set(1, VIEW, DARK_VIEW);
  jump('advanceGuest');
});

section('guestClear', () => {
  bankZero(2);
  set(0, FLAGS, 2);
  jump('advanceGuest');
});

section('carrySet', () => {
  flag(0, true);
  jump('advanceGuest');
});

section('carryReset', () => {
  flag(0, false);
  jump('advanceGuest');
});

section('exchangeLow', () => {
  ins(['TCY', 0]);
  jump('exchangeMemory');
});

section('exchangeHigh', () => {
  ins(['TCY', 8]);
  jump('exchangeMemory');
});

section('exchangeMemory', () => {
  label('register');
  ins(['LDX', 2], 'TMA', ['LDX', 3], 'XMA', ['LDX', 2], 'TAM', 'IYC');
  ins(['YNEC', 8]);
  br('upper');
  jump('advanceGuest');
  label('upper');
  ins(['YNEC', 0]);
  br('register');
  jump('advanceGuest');
});

section('exchangeWorking', () => {
  ins(['TCY', 0]);
  label('register');
  ins(['LDX', 2], 'TMA', 'IYC', 'IYC', 'IYC', 'IYC', 'IYC', 'IYC', 'IYC', 'IYC',
    'XMA', 'DYN', 'DYN', 'DYN', 'DYN', 'DYN', 'DYN', 'DYN', 'DYN', 'TAM', 'IYC',
    ['YNEC', 8]);
  br('register');
  jump('advanceGuest');
});

// The conversions use three scratch nibbles as a down-counter and
// accumulate the same number in the target radix, entirely in the CPU.
function conversionCopy() {
  for (let digit = 0; digit < 3; digit++) copy(2, 13 + digit, 4, digit);
}
function clearConversionDigits() {
  at(2, 13);
  ins(['TCMIY', 0], ['TCMIY', 0], ['TCMIY', 0]);
}

section('convertToDecimal', () => {
  conversionCopy();
  clearConversionDigits();
  set(0, FLAGS, 0);
  set(4, 3, 3);
  read(4, 2);
  at(4, 3);
  ins('ALEM');
  br('highFits');
  jump('conversionOverflow');
  label('highFits');
  on(['MNEA'], 'toDecimalLoop');
  jump('decimalRangeLow');
});

section('decimalRangeLow', () => {
  set(4, 3, 14);
  read(4, 1);
  at(4, 3);
  ins('ALEM');
  br('middleFits');
  jump('conversionOverflow');
  label('middleFits');
  on(['MNEA'], 'toDecimalLoop');
  set(4, 3, 7);
  read(4, 0);
  at(4, 3);
  on(['ALEM'], 'toDecimalLoop');
  jump('conversionOverflow');
});

section('conversionOverflow', () => {
  flag(1, true);
  jump('advanceGuest');
});

function conversionDecrement(max, next) {
  at(4, 0);
  ins('MNEZ');
  br('decrement');
  ins('IYC', 'MNEZ');
  br('borrowOne');
  ins('IYC', 'MNEZ');
  br('borrowTwo');
  jump('advanceGuest');
  label('borrowTwo');
  at(4, 0);
  ins(['TCMIY', max], ['TCMIY', max]);
  br('decrement');
  label('borrowOne');
  at(4, 0);
  ins(['TCMIY', max]);
  label('decrement');
  ins('OMAN', 'TAM');
  jump(next);
}

section('toDecimalLoop', () => conversionDecrement(15, 'decimalIncrement'));

section('decimalIncrement', () => {
  for (let digit = 13; digit < 16; digit++) {
    at(2, digit);
    ins('IMAC', ['TCY', 10], 'YNEA');
    br('store' + digit);
    set(2, digit, 0);
  }
  jump('toDecimalLoop');
  for (let digit = 13; digit < 16; digit++) {
    label('store' + digit);
    at(2, digit);
    ins('TAM');
    jump('toDecimalLoop');
  }
});

section('convertToHex', () => {
  conversionCopy();
  clearConversionDigits();
  set(0, FLAGS, 0);
  jump('toHexLoop');
});

section('toHexLoop', () => conversionDecrement(9, 'hexIncrement'));

section('hexIncrement', () => {
  at(2, 13);
  for (let i = 0; i < 3; i++) {
    ins('IMAC');
    br('carry' + i);
    ins('TAM');
    jump('toHexLoop');
    label('carry' + i);
    ins('TAMIYC');
  }
  jump('toHexLoop');
});

// Decimal arithmetic uses the low half of X4 for its accumulator,
// X5 for counters and bounds, and X6 for a tentative quotient/remainder.
const DECIMAL_KIND = 6, DECIMAL_POS = 7, DECIMAL_REPEAT = 8, DECIMAL_SRC = 9;
const DECIMAL_DEST = 10, DECIMAL_CARRY = 11;
function clearRange(bank, length) {
  at(bank, 0);
  ins(...Array.from({length}, () => ['TCMIY', 0]));
}
function decimalSource() {
  read(5, DECIMAL_SRC);
  ins(['LDX', 2], 'TAY', 'TMA');
}
function decimalDestination(bank = 4) {
  at(5, DECIMAL_DEST);
  ins('TMY', ['LDX', bank]);
}
function startDecimalPosition() {
  copy(5, DECIMAL_POS, 5, DECIMAL_DEST);
  set(5, DECIMAL_SRC, 0);
  set(5, DECIMAL_CARRY, 0);
}

section('decimalMultiply', () => {
  set(5, DECIMAL_KIND, 0);
  jump('decimalValidate');
});

section('decimalDivide', () => {
  set(5, DECIMAL_KIND, 1);
  jump('decimalValidate');
});

section('decimalValidate', () => {
  at(5, 0);
  ins(...Array.from({length: 6}, () => ['TCMIY', 9]));
  ins(['TCY', 0]);
  label('digit');
  ins(['LDX', 2], 'TMA', ['LDX', 5], 'ALEM');
  br('workingValid');
  jump('decimalError');
  label('workingValid');
  ins(['LDX', 3], 'TMA', ['LDX', 5], 'ALEM');
  br('memoryValid');
  jump('decimalError');
  label('memoryValid');
  ins('IYC', ['YNEC', 6]);
  br('digit');
  at(5, DECIMAL_KIND);
  on(['MNEZ'], 'divideValidate');
  jump('multiplyStart');
});

section('decimalError', () => {
  at(2, 0);
  ins(...Array.from({length: 6}, () => ['TCMIY', 14]));
  set(0, FLAGS, 1);
  jump('advanceGuest');
});

section('multiplyStart', () => {
  clearRange(4, 12);
  set(5, DECIMAL_POS, 0);
  jump('multiplyDigit');
});

section('multiplyDigit', () => {
  read(5, DECIMAL_POS);
  ins(['LDX', 3], 'TAY', 'TMA');
  write(5, DECIMAL_REPEAT);
  on(['MNEZ'], 'multiplyRepeat');
  jump('multiplyNext');
});

section('multiplyRepeat', () => {
  startDecimalPosition();
  jump('multiplyAdd');
});

section('multiplyAdd', () => {
  decimalSource();
  at(5, DECIMAL_CARRY);
  ins('MNEZ');
  br('incoming');
  br('sum');
  label('incoming');
  ins(['AC1AC', 0]);
  label('sum');
  decimalDestination();
  ins('AMAAC');
  br('carry');
  at(5, 0);
  ins('ALEM');
  br('store');
  label('carry');
  set(5, DECIMAL_CARRY, 1);
  ins(['AC1AC', 5]);
  jump('multiplyWrite');
  label('store');
  set(5, DECIMAL_CARRY, 0);
  jump('multiplyWrite');
});

section('multiplyWrite', () => {
  decimalDestination();
  ins('TAM');
  at(5, DECIMAL_DEST);
  ins('IMAC', 'TAM');
  at(5, DECIMAL_SRC);
  ins('IMAC', 'TAM', ['TCY', 6], 'YNEA');
  on([], 'multiplyAdd');
  at(5, DECIMAL_CARRY);
  ins('MNEZ');
  br('lastCarry');
  jump('multiplyDecrement');
  label('lastCarry');
  decimalDestination();
  ins('IMAC', 'TAM');
  jump('multiplyDecrement');
});

section('multiplyDecrement', () => {
  at(5, DECIMAL_REPEAT);
  ins('OMAN', 'TAM');
  on(['MNEZ'], 'multiplyRepeat');
  jump('multiplyNext');
});

section('multiplyNext', () => {
  at(5, DECIMAL_POS);
  ins('IMAC', 'TAM', ['TCY', 6], 'YNEA');
  on([], 'multiplyDigit');
  at(4, 6);
  label('upperDigit');
  on(['MNEZ'], 'decimalError');
  ins('IYC', ['YNEC', 12]);
  br('upperDigit');
  at(4, 0);
  label('copyDigit');
  ins(['LDX', 4], 'TMA', ['LDX', 2], 'TAM', 'IYC', ['YNEC', 6]);
  br('copyDigit');
  set(0, FLAGS, 0);
  jump('advanceGuest');
});

section('divideValidate', () => {
  for (let bank = 2; bank <= 3; bank++) {
    at(bank, 4);
    on(['MNEZ'], 'decimalError');
    on(['IYC', 'MNEZ'], 'decimalError');
    at(bank, 0);
    label('seek' + bank);
    ins('MNEZ');
    br('nonzero' + bank);
    ins('IYC', ['YNEC', 4]);
    br('seek' + bank);
    jump('decimalError');
    label('nonzero' + bank);
  }
  jump('divideStart');
});

section('divideStart', () => {
  clearRange(4, 8);
  at(6, 8);
  ins(['TCMIY', 0], ['TCMIY', 0], ['TCMIY', 0], ['TCMIY', 0]);
  at(3, 0);
  label('copyDigit');
  ins(['LDX', 3], 'TMA', ['LDX', 4], 'TAM', 'IYC', ['YNEC', 4]);
  br('copyDigit');
  set(5, DECIMAL_POS, 3);
  jump('divideTrial');
});

section('divideTrial', () => {
  startDecimalPosition();
  jump('divideSubtract');
});

section('divideSubtract', () => {
  read(5, DECIMAL_SRC);
  equal(4, 'divideBorrowOnly');
  equal(5, 'divideBorrowOnly');
  equal(6, 'divideBorrowOnly');
  equal(7, 'divideBorrowOnly');
  ins(['LDX', 2], 'TAY', 'TMA');
  jump('divideSubtractDigit');
});

section('divideBorrowOnly', () => {
  ins('CLA');
  jump('divideSubtractDigit');
});

section('divideSubtractDigit', () => {
  at(5, DECIMAL_CARRY);
  ins('MNEZ');
  br('incoming');
  br('subtract');
  label('incoming');
  ins(['AC1AC', 0]);
  label('subtract');
  decimalDestination();
  ins('SAMAN');
  br('store');
  set(5, DECIMAL_CARRY, 1);
  ins(['AC1AC', 9]);
  jump('divideStore');
  label('store');
  set(5, DECIMAL_CARRY, 0);
  jump('divideStore');
});

section('divideStore', () => {
  decimalDestination(6);
  ins('TAM');
  at(5, DECIMAL_SRC);
  ins('IMAC', 'TAM');
  at(5, DECIMAL_DEST);
  ins('IMAC', 'TAM', ['TCY', 8], 'YNEA');
  on([], 'divideSubtract');
  at(5, DECIMAL_CARRY);
  on(['MNEZ'], 'divideNext');
  jump('divideCommit');
});

section('divideCommit', () => {
  read(5, DECIMAL_POS);
  ins('TAY');
  label('copyDigit');
  ins(['LDX', 6], 'TMA', ['LDX', 4], 'TAM', 'IYC', ['YNEC', 8]);
  br('copyDigit');
  read(5, DECIMAL_POS);
  ins(['AC1AC', 7], 'TAY', ['LDX', 6], 'IMAC', 'TAM');
  jump('divideTrial');
});

section('divideNext', () => {
  at(5, DECIMAL_POS);
  ins('MNEZ');
  br('more');
  jump('divideResult');
  label('more');
  ins('OMAN', 'TAM');
  jump('divideTrial');
});

section('divideResult', () => {
  set(0, FLAGS, 0);
  at(4, 0);
  label('copyRest');
  ins(['LDX', 4], 'TMA', ['LDX', 3], 'TAM', 'IYC', ['YNEC', 4]);
  br('copyRest');
  at(4, 0);
  label('testRest');
  on(['MNEZ'], 'divideNonzero');
  ins('IYC', ['YNEC', 4]);
  br('testRest');
  jump('divideQuotient');
});

section('divideNonzero', () => {
  flag(1, true);
  jump('divideQuotient');
});

section('divideQuotient', () => {
  label('copyDigit');
  at(5, DECIMAL_POS);
  ins('TMA', ['AC1AC', 7], 'TAY', ['LDX', 6], 'TMA',
    ['LDX', 5], ['TCY', DECIMAL_POS], 'TMY', ['LDX', 2], 'TAM');
  at(5, DECIMAL_POS);
  ins('IMAC', 'TAM', ['TCY', 4], 'YNEA');
  br('copyDigit');
  at(2, 4);
  ins(['TCMIY', 0], ['TCMIY', 0]);
  jump('advanceGuest');
});

// Clock digits are little-endian HHMMSS in X7. Input 4 supplies
// the clock-edge signal when the board's clock terminal is patched to it.
section('sampleClock', () => {
  inPin(2);
  write(7, CLOCK_SAMPLE);
  ins(['TBIT1', 3]);
  br('high');
  set(7, CLOCK_INPUT, 0);
  ins('RETN');
  label('high');
  at(7, CLOCK_INPUT);
  ins(['TBIT1', 3]);
  br('done');
  set(7, CLOCK_INPUT, 8);
  read(0, MODE);
  ins(['TCY', CLOCK_ENTRY], 'YNEA');
  on([], 'clockTick');
  label('done');
  ins('RETN');
});

section('clockTick', () => {
  for (let digit = 0; digit < 4; digit++) {
    at(7, digit);
    ins('IMAC', ['TCY', digit % 2 === 0 ? 10 : 6], 'YNEA');
    br('store' + digit);
    set(7, digit, 0);
  }
  jump('clockHours');
  for (let digit = 0; digit < 4; digit++) {
    label('store' + digit);
    at(7, digit);
    ins('TAM', 'RETN');
  }
});

section('clockHours', () => {
  at(7, 4);
  ins('IMAC', ['TCY', 10], 'YNEA');
  br('checkDay');
  set(7, 4, 0);
  at(7, 5);
  ins('IMAC', 'TAM', 'RETN');
  label('checkDay');
  write(7, 4);
  ins('YNEA');
  br('done');
  read(7, 5);
  ins(['TCY', 2], 'YNEA');
  br('done');
  at(7, 4);
  ins(['TCMIY', 0], ['TCMIY', 0]);
  label('done');
  ins('RETN');
});

section('clockFrame', () => {
  set(1, SLOT, 0);
  label('digit');
  read(1, SLOT);
  ins('TAY', 'YNEA');
  outPin(10);
  read(1, SLOT);
  ins('CPAIZ', ['AC1AC', 4], 'TAY', ['LDX', 7], 'TMA', ['LDX', 0]);
  displayA();
  at(1, SLOT);
  ins('IMAC', 'TAM', ['TCY', 6], 'YNEA');
  br('digit');
  jump('frameStatus');
});

section('clockSet', () => {
  set(0, MODE, CLOCK_ENTRY);
  at(7, 0);
  ins(['TCMIY', 0], ['TCMIY', 0]);
  set(7, CLOCK_SLOT, 5);
  jump('clockShow');
});

section('clockShow', () => {
  set(1, VIEW, CLOCK_VIEW);
  jump('main');
});

section('clockEdit', () => {
  read(0, KEY);
  at(7, CLOCK_SLOT);
  ins('TMY', 'TAM');
  at(7, CLOCK_SLOT);
  ins('OMAN', 'TAM', ['TCY', 1], 'YNEA');
  br('done');
  set(0, MODE, BROWSE);
  label('done');
  jump('main');
});

section('guestTime', () => {
  for (let digit = 0; digit < 6; digit++) copy(7, digit, 2, 10 + digit);
  jump('advanceGuest');
});

// A 12-bit maximal-period Galois LFSR supplies three pseudo-random
// digits per instruction. Advancing eleven steps preserves its full period.
section('guestRandom', () => {
  set(7, RANDOM_STEPS, 11);
  jump('randomShift');
});

section('randomShift', () => {
  ins('CLA', ['LDX', 7]);
  for (let digit = 0; digit < 3; digit++) {
    ins(['TCY', RANDOM + digit]);
    call('randomDigit');
  }
  at(7, 0);
  ins('YNEA');
  on([], 'randomTaps');
  jump('randomNext');
});

section('randomDigit', () => {
  ins(['TBIT1', 3]);
  br('carry');
  ins('AMAAC', 'AMAAC', 'TAM', 'CLA', 'RETN');
  label('carry');
  ins('AMAAC', 'AMAAC', 'TAM', 'CLA', ['AC1AC', 0], 'RETN');
});

section('randomTaps', () => {
  for (const [digit, bit] of [[0, 0], [1, 0], [2, 2], [2, 3]]) {
    const tag = digit + '_' + bit;
    at(7, RANDOM + digit);
    ins(['TBIT1', bit]);
    br('clear' + tag);
    ins(['SBIT', bit]);
    br('next' + tag);
    label('clear' + tag);
    ins(['RBIT', bit]);
    label('next' + tag);
  }
  jump('randomNext');
});

section('randomNext', () => {
  at(7, RANDOM_STEPS);
  ins('OMAN', 'TAM');
  on(['MNEZ'], 'randomShift');
  for (let digit = 0; digit < 3; digit++) copy(7, RANDOM + digit, 2, 13 + digit);
  jump('advanceGuest');
});

function link() {
  const locations = new Map();
  const pages = Array.from({length: 64}, (_, index) => ({
    chapter: index >> 4,
    page: index & 15,
    remaining: index === 15 ? 0 : 64,
    blocks: [],
    code: []
  }));
  for (const entry of blocks) {
    const size = entry.code.reduce((sum, line) => sum +
      (line.transfer ? 4 : typeof line === 'string' && line.endsWith(':') ? 0 : 1), 0);
    const page = entry.origin ? pages[entry.origin.chapter * 16 + entry.origin.page] :
      pages.find(candidate => candidate.remaining >= size);
    if (!page) throw new Error(`Native monitor block ${entry.name} needs ${size} words`);
    locations.set(entry.name, page);
    page.remaining -= size;
    page.blocks.push(entry);
  }
  for (const page of pages) {
    for (const {code} of page.blocks) {
      for (const line of code) {
        if (!line.transfer) {
          page.code.push(line);
          continue;
        }
        const target = locations.get(line.name);
        if (!target) throw new Error(`Unknown native monitor block ${line.name}`);
        if (target.chapter !== page.chapter) page.code.push(['CHAPTER', line.name], 'TPC');
        page.code.push(['PAGE', line.name], [line.transfer, line.name]);
      }
    }
  }
  return assembleTms1600(pages);
}

const {rom, symbols} = link();
export const microtronicNativeMonitorRom = rom;
export const microtronicNativeMonitorSymbols = Object.freeze(symbols);
export const microtronicNativeMonitorLayout = Object.freeze({
  pcLow: PCLO,
  pcHigh: PCHI,
  flags: FLAGS,
  working: 0x20,
  memory: 0x30
});
