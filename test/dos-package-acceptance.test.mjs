import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {authoredFixture, BOOT_HEX, CONFIG, BIOS, VGA, sha256, crc32, sourceInventory} from '../scripts/dos-package-acceptance/probe.mjs';
import {readDosPackageZip} from '../scripts/lib/dos-package-zip.mjs';
import {selectDosPackage} from '../src/dos-package-policy.js';

test('independently reviewed authored bootstrap and ZIP goldens, no guest execution', () => {
  const fixture = authoredFixture(fs.readFileSync(new URL('../LICENSE', import.meta.url)));
  const image = fixture.entries[1].data;
  assert.equal(Buffer.from(BOOT_HEX, 'hex').length, 197); assert.equal(image.length, 512);
  assert.equal(sha256(image), '03564a6088a3ecc64833713ca1d406da354a3f6a16d60fdffa59ffbf5cfc5e50');
  assert.equal(crc32(image), 0xbca9a8e3);
  assert.deepEqual([...image.subarray(0x5a, 0x5e)], [0xfa, 0xeb, 0xfe, 0x90]);
  assert.deepEqual([...image.subarray(510)], [0x55, 0xaa]);
  assert.ok(image.subarray(197, 510).every(byte => byte === 0));
  assert.equal(fixture.good.length, 2014); assert.equal(fixture.bad.length, 2020);
  assert.equal(sha256(fixture.good), 'a3511f8daae0e5803ae050974e4a62ff75bf852ccff2681855f5bf1bfd7bdcc4');
  assert.equal(sha256(fixture.bad), 'e783114b8d4874041e28db5603d309b53c2066a6961a1c0b1af86aa5869d7182');
  assert.equal(CONFIG.length, 88); assert.equal(crc32(Buffer.from(CONFIG)), 0xa102216f);
  assert.equal(BIOS.bytes, 65536); assert.equal(VGA.bytes, 38400);
  assert.equal('a'.charCodeAt(0) ^ 0x5a, 0x3b); assert.equal('b'.charCodeAt(0) ^ 0x5a, 0x38);
});

test('fixture reaches exact admitted config-relative HDD and CRC-valid traversal refuses semantically', () => {
  const fixture = authoredFixture(fs.readFileSync(new URL('../LICENSE', import.meta.url)));
  const archive = readDosPackageZip(fixture.good), selected = selectDosPackage(archive, 'pkg/dosbox.conf');
  assert.deepEqual(archive.names, ['pkg/dosbox.conf', 'pkg/disks/boot.img', 'pkg/LICENSE.txt']);
  assert.deepEqual(selected.geometry, {cylinders: 1, heads: 1, sectors: 1});
  assert.equal(selected.imagePath, 'pkg/disks/boot.img'); assert.equal(sha256(selected.readImage()), sha256(fixture.entries[1].data));
  assert.throws(() => readDosPackageZip(fixture.bad), /package path is not canonical/);
  const bytes = Buffer.from(fixture.good); bytes[181] ^= 1;
  assert.throws(() => readDosPackageZip(bytes), /CRC/);
});

test('exact producer orchestration executes inert success/fault controls, never a PTY or child guest', () => {
  const run = spawnSync('/usr/bin/python3', ['-B', 'scripts/dos-package-acceptance/producer.py', '--controls'],
    {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000, maxBuffer: 65536});
  assert.equal(run.status, 0, run.stdout + run.stderr); assert.equal(run.signal, null);
  assert.match(run.stderr, /Ran \d+ tests/); assert.match(run.stderr, /\nOK\n/);
});

test('actual finalizer serializes all 22 role hashes in relative POSIX string order without changing reads', () => {
  // Compile the held function body and its pure helpers, with every path/resource edge inert.
  const control = String.raw`
import ast, hashlib, json
from pathlib import Path, PurePosixPath

tree = ast.parse(Path('scripts/dos-package-acceptance/producer.py').read_text())
names = {'finalize', 'require', 'digest', 'json_bytes', 'error_row'}
nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
assert len(nodes) == len(names)
nodes += [node for node in tree.body if isinstance(node, ast.Assign) and
          any(isinstance(target, ast.Name) and target.id in {'CAPS', 'CASES'} for target in node.targets)]
assert len(nodes) == len(names) + 2
packet = PurePosixPath('packet')
roles = '''a/events.json a/process.json a/pty.raw a/report.json
b/events.json b/process.json b/pty.raw b/report.json
focus-loss/events.json focus-loss/process.json focus-loss/pty.raw focus-loss/report.json
inputs.json inputs/authored.zip inputs/malformed.zip
malformed/events.json malformed/process.json malformed/pty.raw
resources.json runtime.json source.after.json source.before.json'''.split()
assert len(roles) == len(set(roles)) == 22
encode = lambda value: (json.dumps(value, indent=2, allow_nan=False) + '\n').encode()
snapshot = {'identity': {'inode': 19}, 'procs': []}
facts = {'schema': 'bw.dos-package-pty.resources.v1', 'controller': {}, 'cases': {},
         'enclosing': {'before': snapshot, 'after': None},
         'controllerFailure': {'firstFailure': None, 'secondary': []}}
data = {str(packet / name): ('owned role: ' + name).encode() for name in roles if name != 'resources.json'}
data[str(packet / 'source.before.json')] = encode({'head': '1' * 40, 'tree': '2' * 40})
data[str(packet / 'source.after.json')] = data[str(packet / 'source.before.json')]
data[str(packet / '.controller.json')] = encode(facts)
data[str(packet / '.owner.json')] = encode({'path': 'owned-cgroup', 'snapshot': snapshot})
data['.github/workflows/dos-package-acceptance.yml'] = b'unchanged owned workflow'
reads, removed = [], []

class InertPath(PurePosixPath):
    def read_bytes(self):
        reads.append(str(self))
        return data[str(self)]
    def rglob(self, pattern):
        assert self == packet and pattern == '*'
        return [InertPath(name) for name in reversed(list(data)) if name.startswith('packet/')] + [self / 'inputs']
    def is_symlink(self): return False
    def is_file(self): return str(self) in data
    def unlink(self, *, missing_ok):
        assert missing_ok and self.name in ('.controller.json', '.owner.json')
        removed.append(self.name)
        del data[str(self)]

def write_new(path, body):
    assert str(path) not in data, 'exclusive retention'
    data[str(path)] = body

def unexpected_retention(*args):
    raise AssertionError(('unexpected finalizer refusal', args))

def expected_cgroup(value):
    assert value == 'owned-cgroup'
    return InertPath(value)

def external_cleanup(ops, identity):
    assert ops == InertPath('owned-cgroup') and identity == snapshot['identity']
    return snapshot, {'firstFailure': None, 'secondary': []}

env = dict(json=json, hashlib=hashlib, PACKET=InertPath(packet), Path=InertPath,
           write_new=write_new, expected_cgroup=expected_cgroup, CleanupOps=lambda root: root,
           external_cleanup=external_cleanup, retention_fallback=unexpected_retention)
exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual producer finalizer>', 'exec'), env)
assert env['finalize']('owned-cgroup') == 0
audit = json.loads(data[str(packet / 'audit.json')])
expected = [{'path': name, 'bytes': len(data[str(packet / name)]),
             'sha256': hashlib.sha256(data[str(packet / name)]).hexdigest()} for name in sorted(roles)]
assert audit['roles'] == expected, 'all closed role extents/hashes and canonical string order'
assert [row['path'] for row in audit['roles'] if row['path'].startswith('inputs')] == [
    'inputs.json', 'inputs/authored.zip', 'inputs/malformed.zip']
# Path orders components, so this is deliberately different from serialized string order.
path_order = [path.as_posix() for path in sorted(PurePosixPath(name) for name in roles)]
assert path_order != sorted(roles)
assert reads[2:24] == [str(packet / name) for name in path_order], 'existing traversal/read order retained'
assert set(removed) == {'.controller.json', '.owner.json'}
assert {str(path.relative_to(packet)) for path in map(PurePosixPath, data) if path.is_relative_to(packet)} == set(roles) | {'audit.json'}
assert audit['firstFailure'] is None and audit['secondary'] == []
assert audit['workflowSha256'] == hashlib.sha256(data['.github/workflows/dos-package-acceptance.yml']).hexdigest()
assert len(data[str(packet / 'audit.json')]) + sum(row['bytes'] for row in expected) <= env['CAPS']['packetBytes']
print(json.dumps({'actualFinalizer': True, 'closedRoleHashes': len(expected), 'guestOrPtyExecuted': False}))
`;
  const run = spawnSync('/usr/bin/python3', ['-B', '-c', control],
    {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000, maxBuffer: 65536});
  assert.equal(run.status, 0, run.stdout + run.stderr); assert.equal(run.signal, null); assert.equal(run.stderr, '');
  assert.deepEqual(JSON.parse(run.stdout), {actualFinalizer: true, closedRoleHashes: 22, guestOrPtyExecuted: false});
});

test('independent original-only reader accepts full authored packet and rejects rehashed semantic negatives', () => {
  const run = spawnSync('/usr/bin/python3', ['-B', 'scripts/dos-package-acceptance/reader.py', '--controls'],
    {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000, maxBuffer: 65536});
  assert.equal(run.status, 0, run.stdout + run.stderr); assert.equal(run.signal, null); assert.equal(run.stderr, '');
  const result = JSON.parse(run.stdout);
  assert.equal(result.fullPacketPositive, true);
  assert.equal(result.fullyRehashedSemanticRefusals.length, 33);
  assert.ok(result.fullyRehashedSemanticRefusals.every(row => row.result === 'REFUSED'));
  assert.equal(new Set(result.fullyRehashedSemanticRefusals.map(row => row.name)).size, 33);
  assert.equal(result.testOnly, true); assert.equal(result.guestOrPtyExecuted, false);
});


test('bootstrap remains in the same source57 graph and workflow drops privileges before the controller', () => {
  const root = new URL('..', import.meta.url).pathname;
  const producer = fs.readFileSync(new URL('../scripts/dos-package-acceptance/producer.py', import.meta.url), 'utf8');
  const fixed = producer.match(/SOURCE_PATHS = frozenset\('''\n([\s\S]*?)\n'''\.split\(\)\)/);
  assert.ok(fixed, 'closed privileged-bootstrap source path census');
  assert.deepEqual(fixed[1].split('\n').sort(), Object.keys(sourceInventory(root).files).sort());
  assert.equal(fixed[1].split('\n').length, 57);
  const workflow = fs.readFileSync(new URL('../.github/workflows/dos-package-acceptance.yml', import.meta.url), 'utf8');
  assert.match(workflow, /timeout --signal=TERM --kill-after=4s 600s sudo -n/);
  assert.match(workflow, /"\$controller_python" -I -B scripts\/dos-package-acceptance\/producer\.py --bootstrap/);
  assert.doesNotMatch(workflow, /600s python3[^\n]*--run/);
});
