/**
 * Datalogger engine + extension tests.
 *
 * Data store: log, clear, series management, capacity, CSV export.
 * Extension: getInfo shape, block execution, series menu.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DataLogger } from '../src/datalogger.js';
import { DataLoggerExtension } from '../src/datalogger-extension.js';

// ─── DataLogger engine ────────────────────────────────────────────────────

describe('DataLogger: basic logging', () => {
  it('log creates a series and stores entries', () => {
    let t = 0;
    const dl = new DataLogger({ clock: () => t++ });
    dl.log(42, 'temp');
    dl.log(43, 'temp');
    assert.deepEqual(dl.getSeriesNames(), ['temp']);
    assert.equal(dl.getEntryCount('temp'), 2);
    const entries = dl.getEntries('temp');
    assert.equal(entries[0].v, 42);
    assert.equal(entries[1].v, 43);
    assert.equal(entries[0].t, 0);
    assert.equal(entries[1].t, 1);
  });

  it('log defaults to "default" series', () => {
    const dl = new DataLogger({ clock: () => 0 });
    dl.log(1);
    assert.deepEqual(dl.getSeriesNames(), ['default']);
  });

  it('getLatest returns most recent value', () => {
    const dl = new DataLogger({ clock: () => 0 });
    dl.log(10, 's');
    dl.log(20, 's');
    dl.log(30, 's');
    assert.equal(dl.getLatest('s'), 30);
  });

  it('getLatest returns 0 for unknown series', () => {
    const dl = new DataLogger();
    assert.equal(dl.getLatest('nope'), 0);
  });

  it('getEntries returns empty array for unknown series', () => {
    const dl = new DataLogger();
    assert.deepEqual(dl.getEntries('nope'), []);
  });
});

describe('DataLogger: series management', () => {
  it('clear removes entries from one series', () => {
    const dl = new DataLogger({ clock: () => 0 });
    dl.log(1, 'a');
    dl.log(2, 'b');
    dl.clear('a');
    assert.equal(dl.getEntryCount('a'), 0);
    assert.equal(dl.getEntryCount('b'), 1);
  });

  it('clear() with no argument clears all series', () => {
    const dl = new DataLogger({ clock: () => 0 });
    dl.log(1, 'a');
    dl.log(2, 'b');
    dl.clear();
    assert.equal(dl.getSeriesCount(), 0);
  });

  it('getSeriesCount tracks series', () => {
    const dl = new DataLogger({ clock: () => 0 });
    assert.equal(dl.getSeriesCount(), 0);
    dl.log(1, 'x');
    assert.equal(dl.getSeriesCount(), 1);
    dl.log(2, 'y');
    assert.equal(dl.getSeriesCount(), 2);
  });
});

describe('DataLogger: capacity (ring buffer)', () => {
  it('entries wrap at maxEntries', () => {
    let t = 0;
    const dl = new DataLogger({ maxEntries: 3, clock: () => t++ });
    dl.log(1, 's');
    dl.log(2, 's');
    dl.log(3, 's');
    dl.log(4, 's'); // overwrites entry 1
    dl.log(5, 's'); // overwrites entry 2

    assert.equal(dl.getEntryCount('s'), 3);
    const entries = dl.getEntries('s');
    assert.deepEqual(entries.map(e => e.v), [3, 4, 5]);
  });

  it('getLatest works with ring buffer', () => {
    let t = 0;
    const dl = new DataLogger({ maxEntries: 2, clock: () => t++ });
    dl.log(10, 's');
    dl.log(20, 's');
    dl.log(30, 's');
    assert.equal(dl.getLatest('s'), 30);
  });
});

describe('DataLogger: CSV export', () => {
  it('toCSV exports single series with relative timestamps', () => {
    let t = 100;
    const dl = new DataLogger({ clock: () => t++ });
    dl.log(1.5, 'v');
    dl.log(2.5, 'v');
    const csv = dl.toCSV('v');
    assert.equal(csv, 'time_ms,value\n0,1.5\n1,2.5\n');
  });

  it('toCSV returns empty string for unknown series', () => {
    const dl = new DataLogger();
    assert.equal(dl.toCSV('nope'), '');
  });

  it('toCSV with header:false omits header', () => {
    const dl = new DataLogger({ clock: () => 0 });
    dl.log(42, 's');
    const csv = dl.toCSV('s', { header: false });
    assert.equal(csv, '0,42\n');
  });

  it('toCSVAll merges multiple series', () => {
    let t = 0;
    const dl = new DataLogger({ clock: () => t++ });
    dl.log(10, 'a');
    dl.log(20, 'b');
    dl.log(30, 'a');
    const csv = dl.toCSVAll();
    const lines = csv.trim().split('\n');
    assert.equal(lines[0], 'time_ms,a,b');
    assert.equal(lines.length, 4); // header + 3 timestamps
  });
});

describe('DataLogger: persistence', () => {
  it('toJSON/fromJSON round-trip preserves data', () => {
    let t = 0;
    const dl = new DataLogger({ clock: () => t++ });
    dl.log(1, 'x');
    dl.log(2, 'x');
    dl.log(3, 'y');
    const json = dl.toJSON();

    const restored = DataLogger.fromJSON(json);
    assert.deepEqual(restored.getSeriesNames().sort(), ['x', 'y']);
    assert.equal(restored.getEntryCount('x'), 2);
    assert.equal(restored.getEntryCount('y'), 1);
    assert.equal(restored.getLatest('x'), 2);
  });
});

describe('DataLogger: events', () => {
  it('emits log events', () => {
    const dl = new DataLogger({ clock: () => 0 });
    const events = [];
    dl.addListener((ev, detail) => events.push({ ev, ...detail }));
    dl.log(42, 's');
    assert.equal(events.length, 2); // series-add + log
    assert.equal(events[0].ev, 'series-add');
    assert.equal(events[1].ev, 'log');
    assert.equal(events[1].value, 42);
  });

  it('emits clear events', () => {
    const dl = new DataLogger({ clock: () => 0 });
    dl.log(1, 's');
    const events = [];
    dl.addListener((ev, detail) => events.push({ ev, ...detail }));
    dl.clear('s');
    assert.equal(events.length, 1);
    assert.equal(events[0].ev, 'clear');
  });
});

// ─── DataLoggerExtension ──────────────────────────────────────────────────

const ScratchStub = {
  BlockType: { REPORTER: 'reporter', BOOLEAN: 'Boolean', COMMAND: 'command' },
  ArgumentType: { STRING: 'string', NUMBER: 'number' },
  extensions: { register() {} },
};

describe('DataLoggerExtension: getInfo', () => {
  it('returns expected opcodes', () => {
    const origScratch = globalThis.Scratch;
    globalThis.Scratch = ScratchStub;
    try {
      const ext = new DataLoggerExtension();
      const info = ext.getInfo();
      assert.equal(info.id, 'datalogger');
      const opcodes = info.blocks.filter(b => typeof b === 'object').map(b => b.opcode);
      assert.deepEqual(opcodes, [
        'logValue', 'clearSeries', 'clearAll',
        'latestValue', 'entryCount', 'seriesCount', 'seriesNames',
      ]);
    } finally {
      globalThis.Scratch = origScratch;
    }
  });
});

describe('DataLoggerExtension: block execution', () => {
  it('logValue creates logger and logs', () => {
    const ext = new DataLoggerExtension();
    ext.logValue({ VALUE: 42, SERIES: 'temp' });
    assert.ok(ext.logger);
    assert.equal(ext.latestValue({ SERIES: 'temp' }), 42);
    assert.equal(ext.entryCount({ SERIES: 'temp' }), 1);
  });

  it('clearSeries clears one series', () => {
    const ext = new DataLoggerExtension();
    ext.logValue({ VALUE: 1, SERIES: 'a' });
    ext.logValue({ VALUE: 2, SERIES: 'b' });
    ext.clearSeries({ SERIES: 'a' });
    assert.equal(ext.entryCount({ SERIES: 'a' }), 0);
    assert.equal(ext.entryCount({ SERIES: 'b' }), 1);
  });

  it('clearAll clears everything', () => {
    const ext = new DataLoggerExtension();
    ext.logValue({ VALUE: 1, SERIES: 'a' });
    ext.logValue({ VALUE: 2, SERIES: 'b' });
    ext.clearAll();
    assert.equal(ext.seriesCount(), 0);
  });

  it('seriesNames returns comma-separated list', () => {
    const ext = new DataLoggerExtension();
    ext.logValue({ VALUE: 1, SERIES: 'x' });
    ext.logValue({ VALUE: 2, SERIES: 'y' });
    assert.equal(ext.seriesNames(), 'x, y');
  });

  it('reporters return 0 with no logger', () => {
    const ext = new DataLoggerExtension();
    assert.equal(ext.latestValue({ SERIES: 'x' }), 0);
    assert.equal(ext.entryCount({ SERIES: 'x' }), 0);
    assert.equal(ext.seriesCount(), 0);
    assert.equal(ext.seriesNames(), '');
  });
});

describe('DataLoggerExtension: series menu', () => {
  it('shows series names when logger has data', () => {
    const ext = new DataLoggerExtension();
    ext.logValue({ VALUE: 1, SERIES: 'temp' });
    ext.logValue({ VALUE: 2, SERIES: 'volt' });
    const menu = ext._getSeriesMenu();
    assert.deepEqual(menu.map(i => i.value), ['temp', 'volt']);
  });

  it('shows placeholder when no logger', () => {
    const ext = new DataLoggerExtension();
    const menu = ext._getSeriesMenu();
    assert.equal(menu.length, 1);
    assert.equal(menu[0].value, '');
  });
});
