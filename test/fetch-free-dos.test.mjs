// The free-licensed DOS package: fetch-free-dos materializes the three MIT
// MS-DOS 2.0 kernel files (Microsoft's own, github.com/microsoft/MS-DOS v2.0/bin)
// and verifies each against a pinned SHA-256, refusing anything else. Fully
// deterministic here — the fetch is injected, so no network and nothing to skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FREE_DOS_FILES, fetchFreeDos, SOURCE_BASE, LICENCE } from '../scripts/fetch-free-dos.mjs';

test('the manifest is exactly the three MIT kernel files, pinned by sha-256', () => {
    assert.deepEqual(Object.keys(FREE_DOS_FILES).sort(), ['COMMAND.COM', 'MSDOS.SYS', 'SYSINIT.OBJ']);
    for (const h of Object.values(FREE_DOS_FILES)) assert.match(h, /^[0-9a-f]{64}$/);
    assert.match(SOURCE_BASE, /microsoft\/MS-DOS/);
    assert.match(LICENCE, /MIT/);
});

test('content whose hash is not the pinned MIT file is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fd-'));
    const junk = async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('not MS-DOS').buffer });
    await assert.rejects(() => fetchFreeDos(dir, { fetchImpl: junk }), /is not the pinned MIT/);
});

test('an HTTP error is surfaced, not silently trusted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fd-'));
    const notFound = async () => ({ ok: false, status: 404 });
    await assert.rejects(() => fetchFreeDos(dir, { fetchImpl: notFound }), /HTTP 404/);
});

test('a served file matching its pinned hash is written (accept path)', async () => {
    // A fabricated manifest whose payloads hash to the pins we pass — proves the
    // verify-and-write path without needing the real MIT bytes (the hash is the gate).
    const dir = mkdtempSync(join(tmpdir(), 'fd-'));
    const { createHash } = await import('node:crypto');
    const payloads = { 'MSDOS.SYS': 'ms', 'COMMAND.COM': 'cmd', 'SYSINIT.OBJ': 'sys' };
    const files = Object.fromEntries(Object.entries(payloads).map(([n, s]) => [n, createHash('sha256').update(s).digest('hex')]));
    const serve = async (url) => { const n = url.split('/').pop(); return { ok: true, arrayBuffer: async () => new TextEncoder().encode(payloads[n]).buffer }; };
    const r = await fetchFreeDos(dir, { fetchImpl: serve, files });
    assert.equal(r.files.length, 3);
    for (const n of Object.keys(payloads)) assert.ok(existsSync(join(dir, n)), `${n} written`);
});
