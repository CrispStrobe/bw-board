#!/usr/bin/env node
// Compares firmware only through the common machine's physical contacts, display,
// teaching RAM and terminals. Manual transcriptions are optional external inputs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {Cp1Machine} from '../src/cp1-machine.js';

const {values: options} = parseArgs({options: {
    oracle: {type: 'string'}, candidate: {type: 'string'}, manual: {type: 'string'}, report: {type: 'string'},
    'sb3-creator': {type: 'string'}, 'circuit-ui': {type: 'string'}, electrical: {type: 'boolean'},
    'manual-steps': {type: 'string'},
}});
if (!options.oracle) throw new Error('--oracle must point to an external 2716 monitor image');
const boardPath = fileURLToPath(new URL('..', import.meta.url));
const examplesPath = resolve(options['sb3-creator'] ?? join(boardPath, '..', 'sb3-creator'));
const circuitUiPath = resolve(options['circuit-ui'] ?? join(boardPath, '..', 'bw-circuit-ui'));
const importFromExamples = file => import(pathToFileURL(join(examplesPath, file)));
const {CP1_MNEMONICS, parseCp1Program} = await importFromExamples('src/utils/cp1Program.js');

const HISTORICAL_SHA1 = 'ff4befcf82a664950186d3af1843fdef70d2209f';
const DIGITS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x27, 0x7f, 0x6f];
const COMMANDS = new Set([...CP1_MNEMONICS, 'ORG', 'DB']);
const digest = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const gallerySource = name => readFileSync(join(examplesPath, 'examples', name, 'program.cp1'), 'utf8');
const revision = path => execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();

function createPanel(rom, expansion = false, beforeStartup) {
    const edges = [];
    const machine = new Cp1Machine({rom, expansion});
    const advance = ms => {
        while (ms > 0) {
            const step = Math.min(ms, 50);
            assert.equal(machine.advanceCycles(step * 400).reached, true);
            ms -= step;
        }
    };
    const key = name => {
        machine.setKey(name, true);
        advance(100);
        machine.setKey(name, false);
        advance(100);
    };
    const entry = address => {
        for (const digit of String(address).padStart(3, '0')) key(digit);
        key('PC');
    };
    const recordPorts = () => {
        const previous = new Map();
        for (const port of [1, 2, 4, 5]) previous.set(port, machine.getPortState(port).latch);
        return machine.addPortListener((port, state, tMs) => {
            if (previous.has(port) && previous.get(port) !== state.latch) {
                previous.set(port, state.latch);
                edges.push({port, value: state.latch, tMs});
            }
        });
    };
    const display = () => machine.getDisplay().digits;
    const memory = () => Array.from({length: machine.capacity}, (_, address) => {
        const {opcode, operand} = machine.readCell(address);
        return [opcode, operand];
    });
    const ports = () => [1, 2, 4, 5].map(port => machine.getPortState(port).latch);
    beforeStartup?.(machine);
    advance(2000);
    return {machine, advance, key, entry, recordPorts, edges, display, memory, ports};
}

function loadWords(machine, words) {
    machine.loadProgram([], {clear: true});
    for (const {address, opcode, operand} of words) machine.writeCell(address, opcode, operand);
}

const decimal = value => [...String(value).padStart(3, '0')].map(digit => DIGITS[Number(digit)]);
const accumulator = value => [0x77, 0x3f, 0xbf, ...decimal(value)];
const pc = value => [0x73, 0, 0x80, ...decimal(value)];

const MONITOR_CASES = [
    {name: 'base startup and CPU reset clear teaching RAM', checkReset: true},
    {name: 'CP3 startup and CPU reset clear teaching RAM', expansion: true, checkReset: true},
    {name: 'startup, keypad entry, memory recall and step', keys: [
        '0', '0', '0', 'INP', '|', '0', '4', '0', '4', '2', 'INP', '|',
        '0', '6', '0', '3', '2', 'INP', '|', '0', '1', '0', '0', '0', 'INP', '|',
        '9', 'OUT', '|', '0', '0', '0', 'OUT', '|', '0', '0', '0', 'PC', '|',
        'STEP', '|', 'ACC', '|', 'STEP', '|', 'STEP', '|', 'CLR', '|',
    ], cells: [0, 1, 2, 32]},
    {name: 'overflow', words: [[4, 255], [7, 4], [2, 0], [1, 0], [0, 1]], cells: [4]},
    {name: 'underflow', words: [[4, 0], [8, 4], [2, 0], [1, 0], [0, 1]], cells: [4]},
    {name: 'logical operations and two-byte load/store', words: [
        [5, 10], [6, 11], [5, 12], [14, 0], [15, 13], [6, 14], [2, 0], [9, 6],
        [0, 0], [0, 0], [8, 201], [0, 0], [0, 165], [0, 119],
    ], cells: [11, 14]},
    {name: 'conditional branch and shared comparison state', words: [
        [4, 7], [10, 9], [11, 6], [4, 0], [18, 0], [1, 0], [4, 85], [18, 0], [1, 0], [0, 7],
    ]},
    {name: 'HLT clears the comparison before RUN resumes', resume: true, words: [
        [4, 7], [10, 10], [1, 0], [11, 7], [4, 44], [18, 0], [1, 0], [4, 99], [18, 0], [1, 0], [0, 7],
    ]},
    {name: 'indirect load, store and jump', words: [
        [19, 10], [20, 11], [21, 12], [4, 0], [18, 0], [1, 0], [18, 0], [1, 0], [0, 0],
        [0, 0], [0, 13], [0, 31], [0, 6], [0, 147],
    ], cells: [31]},
    {name: 'invalid commands', words: [[99, 0]], cells: [0]},
    {name: 'invalid port selector', words: [[4, 1], [18, 9], [1, 0]]},
    {name: 'base address boundary', words: [[9, 128]]},
    {name: 'CP3 addresses and P3/P4/P5 terminals', expansion: true, upper: [
        [4, 85], [23, 0], [4, 42], [24, 0], [22, 0], [6, 240], [18, 0], [1, 0],
    ], words: [[9, 128]], cells: [128, 240]},
];

function contacts(rom) {
    const {machine, advance, key, display} = createPanel(rom);
    for (let digit = 0; digit < 10; digit++) {
        for (const contact of [0, 1]) {
            key('CLR');
            machine.setKey(String(digit), true, contact);
            advance(250);
            assert.deepEqual(display(), [0, 0, 128, 0, 0, DIGITS[digit]], `digit ${digit}, contact ${contact}`);
            machine.setKey(String(digit), false, contact);
            advance(40);
        }
    }
    return {observations: [{testedClosures: 20}]};
}

function displayCadence(rom) {
    const {machine} = createPanel(rom);
    const rowSamples = Array(6).fill(0);
    const firstDigitStarts = [];
    let lastActiveRow = -1;
    for (let index = 0; index < 1600; index++) {
        machine.advanceCycles(40);
        const active = machine.getDisplay().hardwareActiveDigits;
        const row = active.indexOf(true);
        assert.ok(active.filter(Boolean).length <= 1, 'at most one digit driver may be on');
        if (row >= 0) rowSamples[row]++;
        if (row === 0 && lastActiveRow !== 0) firstDigitStarts.push(machine.tMs);
        if (row >= 0) lastActiveRow = row;
    }
    const framesPerSecond = 1000 * (firstDigitStarts.length - 1) /
        (firstDigitStarts.at(-1) - firstDigitStarts[0]);
    assert.ok(framesPerSecond >= 60, `display refresh measured ${framesPerSecond} frames/s`);
    for (const samples of rowSamples) {
        assert.ok(samples > 150 && samples < 350, `uneven or insufficient digit duty (${samples}/1600)`);
    }
    return {framesPerSecond, sampleDuty: rowSamples.map(count => count / 1600)};
}

function runMonitor(rom, scenario) {
    const fill = machine => {
        for (let address = 0; address < machine.capacity; address++) {
            machine.writeCell(address, 13, 255 - address);
        }
    };
    const panel = createPanel(rom, scenario.expansion, scenario.checkReset ? fill : undefined);
    const {machine, display, key, entry, advance} = panel;
    const read = () => ({display: display(), ports: panel.ports(),
        memory: scenario.cells?.map(address => ({address, ...machine.readCell(address)})) ?? []});
    const observations = [read()];
    if (scenario.checkReset) {
        const cleared = () => assert.ok(panel.memory().every(([opcode, operand]) => opcode === 0 && operand === 0),
            'the monitor must clear all installed teaching cells');
        cleared();
        fill(machine);
        machine.reset();
        advance(2000);
        cleared();
        observations.push(read());
    } else if (scenario.words) {
        const words = scenario.words.map(([opcode, operand], address) => ({address, opcode, operand}));
        for (const [index, [opcode, operand]] of (scenario.upper ?? []).entries()) {
            words.push({address: 128 + index, opcode, operand});
        }
        loadWords(machine, words);
        if (scenario.expansion) machine.setPortInput(3, 165, 255);
        entry(0);
        key('RUN');
        advance(300);
        observations.push(read());
        key('ACC');
        observations.push(read());
        if (scenario.resume) {
            key('RUN');
            advance(300);
            observations.push(read());
            assert.equal(machine.getPortState(2).latch, 44);
        }
    } else {
        for (const name of scenario.keys) {
            if (name === '|') observations.push(read());
            else key(name);
        }
    }
    return {observations};
}

function gallery(name, rom) {
    const source = gallerySource(name);
    const program = parseCp1Program(source);
    assert.equal(program.ok, true);
    const panel = createPanel(rom);
    const {machine, advance, key, entry, display, edges} = panel;
    const startup = {display: display(), ports: panel.ports()};
    loadWords(machine, program.words);
    entry(program.entry);
    const stopRecording = panel.recordPorts();
    key('RUN');
    const observations = [];
    if (name === 'cp1-first-display') {
        advance(250);
        observations.push({display: display()});
        assert.deepEqual(display(), accumulator(42));
    } else if (name === 'cp1-switch-input' || name === 'cp1-cp5-binary') {
        const cp5 = name === 'cp1-cp5-binary';
        for (const value of cp5 ? [255, 0, 1, 2, 4, 8, 16, 32, 64, 128, 165, 90, 255] : [255, 254, 255]) {
            machine.setPortInput(1, value, 255);
            advance(cp5 ? 300 : 200);
            const expected = cp5 ? value : value & 1;
            const output = machine.getPortState(2).latch;
            const stored = machine.readCell(32);
            observations.push({input: value, display: display(), output, stored});
            assert.deepEqual(display(), accumulator(expected), `P1=${value}`);
            if (cp5) {
                assert.equal(output, expected);
                assert.deepEqual(stored, {opcode: 0, operand: expected});
            }
        }
    } else {
        advance(1600);
        const transitions = edges.filter(edge => edge.port === 2);
        assert.ok(transitions.length >= 5);
        for (const [index, edge] of transitions.slice(0, 5).entries()) {
            assert.equal(edge.value, index % 2 ? 255 : 254);
            if (index) {
                const elapsed = edge.tMs - transitions[index - 1].tMs;
                assert.ok(elapsed >= 216 && elapsed <= 236, `VZG 200 half-period: ${elapsed} ms`);
            }
        }
    }
    stopRecording();
    key('STP');
    advance(100);
    const stopped = {display: display(), ports: panel.ports()};
    advance(250);
    assert.deepEqual(display(), stopped.display, 'STP must leave a stable screen');
    assert.deepEqual(panel.ports(), stopped.ports, 'STP must leave stable output latches');
    return {sourceSha256: digest(source), startup, observations, edges, stopped};
}

async function electrical(rom, workbench, {assertOutputByte, setInputByte}) {
    const {Circuit, createCp1Adapter, json} = workbench;
    const circuit = Circuit.fromJSON(json);
    const adapter = createCp1Adapter({rom, partId: 'cp1'});
    adapter.attachBoard(circuit.board);
    const {machine} = adapter;
    const advance = ms => {
        for (let remaining = ms; remaining > 0; remaining -= 50) {
            adapter.advanceNs(Math.min(50, remaining) * 1e6);
        }
    };
    const key = name => {
        machine.setKey(name, true);
        advance(100);
        machine.setKey(name, false);
        advance(100);
    };
    advance(2000);
    assertOutputByte(circuit, 255);
    const program = parseCp1Program(gallerySource('cp1-cp5-binary'));
    assert.equal(program.ok, true);
    loadWords(machine, program.words);
    setInputByte(circuit, 255);
    const edges = [];
    const stopRecording = machine.addPortListener((port, state, tMs) => {
        if (port === 2 && (edges.at(-1)?.value ?? 255) !== state.latch) edges.push({value: state.latch, tMs});
    });
    for (const name of ['0', '0', '0', 'PC', 'RUN']) key(name);
    advance(300);
    stopRecording();
    assert.deepEqual(edges.map(edge => edge.value), [0, 255]);
    const clearIntervalMs = edges[1].tMs - edges[0].tMs;
    assert.ok(clearIntervalMs >= 200);
    const patterns = [];
    for (const value of [0, 255, 1, 2, 4, 8, 16, 32, 64, 128, 165, 90, 0]) {
        setInputByte(circuit, value);
        advance(300);
        assert.equal(machine.getPortState(1).value, value);
        assert.equal(machine.getPortState(2).latch, value);
        assert.deepEqual(machine.readCell(32), {opcode: 0, operand: value});
        assert.deepEqual(machine.getDisplay().digits, accumulator(value));
        const channels = assertOutputByte(circuit, value);
        patterns.push({value, ledAmps: channels.map(channel => channel.ledAmps)});
    }
    setInputByte(circuit, 165);
    advance(300);
    const beforePause = machine.cycles;
    setInputByte(circuit, 164);
    assert.equal(machine.cycles, beforePause);
    assert.equal(machine.getPortState(2).latch, 165);
    assertOutputByte(circuit, 165);
    advance(300);
    assert.equal(machine.getPortState(2).latch, 164);
    assert.deepEqual(machine.readCell(32), {opcode: 0, operand: 164});
    assertOutputByte(circuit, 164);
    return {clearIntervalMs, patterns, pauseHoldsOutput: true};
}

// The transcription uses leading-dot directives and column labels. RAW words
// may be embedded display data that the executable-command validator rejects.
function expandListing(source, expansion) {
    const raw = new Map();
    const labels = new Map();
    const lines = source.split(/\r?\n/).map(line => {
        const code = line.split(';', 1)[0];
        let text = code.trim();
        const equ = text.match(/^\.EQU\s+(\w+)\s*,\s*(.+)$/i);
        if (equ) return {label: equ[1], text: `EQU ${equ[2]}`};
        text = text.replace(/(^|\s)\.(ORG|DB|RAW)(?=\s)/i, '$1$2');
        const isCommand = name => COMMANDS.has(name.toUpperCase()) || name.toUpperCase() === 'RAW';
        const pair = text.match(/^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(.*)$/);
        if (pair && isCommand(pair[2]) && (!isCommand(pair[1]) || /^[^\s]/.test(code))) {
            return {label: pair[1], text: pair[2] + pair[3]};
        }
        if (/^[A-Za-z_]\w*$/.test(text) && !isCommand(text)) return {label: text, text: ''};
        return {text};
    });
    for (const {label} of lines) {
        if (label) labels.set(label.toUpperCase(), `manual_${label}`);
    }
    const commandLines = new Set();
    const format = lines.map(({label, text}, index) => {
        const data = text.match(/^RAW\s+(\d{1,3})\.(\d{1,3})$/i);
        if (data) {
            const [opcode, operand] = data.slice(1).map(Number);
            assert.ok(opcode <= 255 && operand <= 255);
            raw.set(index + 1, {opcode, operand});
            text = 'DB 0';
        }
        const [mnemonic, ...operands] = text.split(/\s+/);
        if (CP1_MNEMONICS.indexOf(mnemonic.toUpperCase()) > 0) commandLines.add(index + 1);
        const expression = operands.join(' ').replace(/[A-Za-z_]\w*/g, name => labels.get(name.toUpperCase()) ?? name);
        text = `${mnemonic} ${expression}`.trim();
        if (mnemonic.toUpperCase() === 'DB') text = text.replace(/\?/g, '0');
        if (label) {
            const prefix = labels.get(label.toUpperCase());
            return mnemonic === 'EQU' ? `${prefix} ${text}` : `${prefix}: ${text}`;
        }
        return text;
    }).join('\n');
    const result = parseCp1Program(format, {expansion});
    if (!result.ok) return {diagnostics: result.diagnostics.map(({code, line}) => ({code, line}))};
    const words = result.words.map(word => ({...word, ...raw.get(word.line)}));
    const first = words.filter(word => commandLines.has(word.line))
        .reduce((earliest, word) => word.line < earliest.line ? word : earliest);
    return {words, entry: first.address};
}

function readWordListing(name, source) {
    const words = [];
    for (const [index, line] of source.split(/\r?\n/).entries()) {
        const text = line.split('#', 1)[0].trim();
        if (!text) continue;
        const match = text.match(/^(\d{1,3})\s+(?:[a-z][a-z0-9]*\s+)?(\d{1,3})\.(\d{1,3})(?:\s.*)?$/i);
        if (!match || match.slice(1).map(Number).some(value => value > 255)) {
            return {diagnostics: [{code: 'manual-word', line: index + 1}]};
        }
        const [address, opcode, operand] = match.slice(1).map(Number);
        words.push({address, opcode, operand});
    }
    if (!words.length || new Set(words.map(word => word.address)).size !== words.length) {
        return {diagnostics: [{code: 'manual-addresses'}]};
    }
    return {words, entry: name === 'listing_045.words' ? 104 : words[0].address,
        expansion: words.some(word => word.address >= 128)};
}

function runListing(rom, {words, entry, expansion}) {
    const panel = createPanel(rom, expansion);
    const {machine, advance, display, key} = panel;
    loadWords(machine, words);
    const initial = panel.memory();
    const stopRecording = panel.recordPorts();
    panel.entry(entry);
    const beforeRun = display();
    key('RUN');
    const snapshots = [];
    for (const [input, ms] of [[255, 400], [254, 400], [255, 600], [253, 350], [255, 250]]) {
        machine.setPortInput(1, input, 255);
        advance(ms);
        snapshots.push({display: display(), ports: panel.ports()});
    }
    key('STP');
    advance(100);
    stopRecording();
    const memory = panel.memory().flatMap(([opcode, operand], address) =>
        opcode === initial[address][0] && operand === initial[address][1] ? [] : [{address, opcode, operand}]);
    return {beforeRun, expectedEntry: pc(entry), snapshots, stopped: display(), ports: panel.ports(),
        changedAddresses: memory.map(cell => cell.address), changedMemorySha256: digest(JSON.stringify(memory)),
        edges: panel.edges};
}

function stepListing(rom, {words, entry, expansion}, count) {
    const panel = createPanel(rom, expansion);
    const {machine, advance, display, key} = panel;
    loadWords(machine, words);
    panel.entry(entry);
    const steps = [];
    for (let index = 0; index < count; index++) {
        key('STEP');
        advance(180);
        const afterStep = display();
        key('ACC');
        steps.push({afterStep, accumulator: display(), ports: panel.ports(),
            memorySha256: digest(JSON.stringify(panel.memory()))});
    }
    return {steps};
}

function difference(oracle, candidate, keys) {
    return keys.filter(key => JSON.stringify(oracle[key]) !== JSON.stringify(candidate[key]));
}

function compareEdges(oracle, candidate, limit = Infinity) {
    const left = oracle.slice(0, limit);
    const right = candidate.slice(0, limit);
    const sequence = edges => edges.map(({port, value}) => [port, value]);
    const period = edges => edges.slice(1).map((edge, index) => Number((edge.tMs - edges[index].tMs).toFixed(3)));
    return {
        sequenceMatched: JSON.stringify(sequence(left)) === JSON.stringify(sequence(right)),
        oracleCount: oracle.length,
        candidateCount: candidate.length,
        oracleIntervalsMs: period(left),
        candidateIntervalsMs: period(right),
    };
}

const manualSteps = Number(options['manual-steps'] ?? 0);
assert.ok(Number.isInteger(manualSteps) && manualSteps >= 0 && manualSteps <= 32,
    '--manual-steps must be an integer from 0 to 32');
const oracle = new Uint8Array(readFileSync(options.oracle));
assert.equal(digest(oracle, 'sha1'), HISTORICAL_SHA1);
const candidate = options.candidate && new Uint8Array(readFileSync(options.candidate));
if (candidate) {
    assert.equal(candidate.length, 2048);
    assert.notEqual(digest(candidate, 'sha1'), HISTORICAL_SHA1, 'candidate must be independently built');
}
const run = (callback, rom) => {
    try {
        return callback(rom);
    } catch (error) {
        return {failure: error.message};
    }
};

const report = {format: 'brickwright.cp1-firmware-comparison', version: 1, clockHz: 6000000,
    oracleSha1: HISTORICAL_SHA1, candidateSha1: candidate ? digest(candidate, 'sha1') : null,
    boardRevision: revision(boardPath), examplesRevision: revision(examplesPath),
    checkerSha256: digest(readFileSync(new URL(import.meta.url))),
    gallery: [], monitor: [], manual: []};
const monitorTests = MONITOR_CASES.map(scenario => ({name: scenario.name, test: rom => runMonitor(rom, scenario)}));
monitorTests.push({name: 'physical numeric contacts and held key debounce', test: contacts});
for (const {name, test} of monitorTests) {
    const reference = run(test, oracle);
    const replacement = candidate ? run(test, candidate) : null;
    const usable = replacement && !reference.failure && !replacement.failure;
    report.monitor.push({name, oracle: reference, candidate: replacement,
        differences: usable ? reference.observations.flatMap((checkpoint, index) => {
            const fields = difference(checkpoint, replacement.observations[index], ['display', 'ports', 'memory']);
            return fields.length ? [{index, fields}] : [];
        }) : null});
}
report.displayTiming = {oracle: run(displayCadence, oracle),
    candidate: candidate ? run(displayCadence, candidate) : null};
for (const name of ['cp1-first-display', 'cp1-switch-input', 'cp1-blink', 'cp1-cp5-binary']) {
    const reference = run(rom => gallery(name, rom), oracle);
    const replacement = candidate ? run(rom => gallery(name, rom), candidate) : null;
    const usable = replacement && !reference.failure && !replacement.failure;
    report.gallery.push({name, oracle: reference, candidate: replacement,
        differences: usable ? difference(reference, replacement, ['startup', 'observations', 'stopped']) : null,
        portTiming: usable ? compareEdges(reference.edges, replacement.edges, name === 'cp1-blink' ? 5 : Infinity) : null});
}
if (options.electrical) {
    const helpers = await importFromExamples('scripts/verify-cp1-cp5.mjs');
    const workbench = await helpers.loadWorkbench({board: boardPath, circuitUi: circuitUiPath});
    report.electrical = {identity: workbench.identity};
    for (const [name, rom] of [['oracle', oracle], ['candidate', candidate]]) {
        if (!rom) continue;
        try {
            report.electrical[name] = await electrical(rom, workbench, helpers);
        } catch (error) {
            report.electrical[name] = {failure: error.message};
        }
    }
}
if (options.manual) {
    for (const name of readdirSync(options.manual).filter(name => /^listing_\d+\.(asm|words)$/.test(name)).sort()) {
        const source = readFileSync(join(options.manual, name), 'utf8');
        let expansion;
        let listing;
        if (name.endsWith('.words')) {
            listing = readWordListing(name, source);
            expansion = listing.expansion;
        } else {
            expansion = false;
            listing = expandListing(source, expansion);
        }
        if (listing.diagnostics && name.endsWith('.asm')) {
            expansion = true;
            listing = expandListing(source, expansion);
        }
        const metadata = {name, sourceSha256: digest(source)};
        if (listing.diagnostics) {
            report.manual.push({...metadata, assemblyDiagnostics: listing.diagnostics});
            continue;
        }
        const test = rom => runListing(rom, {...listing, expansion});
        const reference = run(test, oracle);
        const replacement = candidate ? run(test, candidate) : null;
        const usable = replacement && !reference.failure && !replacement.failure;
        let stepping;
        if (manualSteps) {
            const step = rom => stepListing(rom, {...listing, expansion}, manualSteps);
            const referenceSteps = run(step, oracle);
            const candidateSteps = candidate ? run(step, candidate) : null;
            stepping = {oracle: referenceSteps, candidate: candidateSteps,
                firstDifference: referenceSteps.steps && candidateSteps?.steps
                    ? referenceSteps.steps.findIndex((state, i) =>
                        difference(state, candidateSteps.steps[i], ['afterStep', 'accumulator', 'ports', 'memorySha256']).length)
                    : null};
        }
        report.manual.push({...metadata, entry: listing.entry, expansion, oracle: reference, candidate: replacement,
            differences: usable ? difference(reference, replacement, ['beforeRun', 'snapshots', 'stopped',
                'ports', 'changedMemorySha256']) : null,
            portTiming: usable ? compareEdges(reference.edges, replacement.edges) : null, stepping});
    }
}
const text = JSON.stringify(report, null, 2);
if (options.report) writeFileSync(options.report, text + '\n');
else console.log(text);
if (report.gallery.some(row => row.oracle.failure || row.candidate?.failure || row.differences?.length ||
    row.portTiming?.sequenceMatched === false) || report.electrical?.oracle?.failure ||
    report.electrical?.candidate?.failure || report.displayTiming.oracle.failure || report.displayTiming.candidate?.failure ||
    report.monitor.some(row => row.oracle.failure || row.candidate?.failure || row.differences?.length) ||
    report.manual.some(row => row.assemblyDiagnostics || row.oracle?.failure || row.candidate?.failure ||
        row.stepping?.oracle.failure || row.stepping?.candidate?.failure)) process.exitCode = 1;
