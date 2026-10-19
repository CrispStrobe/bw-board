import hashlib, json, os, pathlib, resource, signal, subprocess, time

ROOT = pathlib.Path('/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-parity-results-20261002')
OUT = pathlib.Path('/tmp/native-cold-bios-reference-census-controls-20261003')
NODE = pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
HELPER = pathlib.Path(__file__).resolve()
HOOKS = ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'BW_HOT_NAPI_PROFILE', 'NODE_V8_COVERAGE']

def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def sources():
    paths = sorted(p for p in (ROOT / 'test').iterdir() if p.is_file() and p.suffix in ['.js', '.mjs'])
    paths.append(ROOT / 'scripts/oracle-census.mjs')
    return {str(p.relative_to(ROOT)): sha(p) for p in sorted(paths)}

def git(args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True, timeout=5).strip()

def limits():
    os.nice(10)
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 << 20, 8 << 20))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

OUT.mkdir(exist_ok=False)
before = sources()
head = git(['rev-parse', 'HEAD'])
status = git(['status', '--porcelain'])
node_sha, helper_sha = sha(NODE), sha(HELPER)
env = dict(os.environ)
for k in HOOKS:
    env[k] = ''
env.pop('BW_COLD_REFERENCE_OUTPUT', None)
pattern = 'cold BIOS capture has a dedicated|capture-output census resolution|every guard-then-skip|the debt list'
argv = [str(NODE), '--max-old-space-size=128', '--test', '--test-name-pattern=' + pattern, 'test/census-covers-the-tree.test.mjs', 'test/oracle-census.test.mjs']
invocation = {'argv': argv, 'cwd': str(ROOT), 'hooks': {k: env[k] for k in HOOKS}, 'BW_COLD_REFERENCE_OUTPUT': 'unset', 'bounds': {'cpuSeconds': 10, 'wallSeconds': 30, 'heapMiB': 128, 'fileMiB': 8, 'coreBytes': 0, 'nice': 10}, 'headBefore': head, 'statusBefore': status, 'nodeSha256Before': node_sha, 'helperSha256Before': helper_sha, 'sourceBefore': before}
(OUT / 'invocation.json').write_text(json.dumps(invocation, indent=2) + '\n')
start = time.monotonic()
timeout = False
with (OUT / 'stdout').open('xb') as stdout, (OUT / 'stderr').open('xb') as stderr:
    child = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, preexec_fn=limits, start_new_session=True)
    try:
        code = child.wait(timeout=30)
    except subprocess.TimeoutExpired:
        timeout = True
        os.killpg(child.pid, signal.SIGKILL)
        code = child.wait()
receipt = {'returncode': code, 'timeout': timeout, 'wallSeconds': time.monotonic() - start, 'childPid': child.pid, 'status': 'FAIL', 'scope': 'Five selected census integration controls only; no reference capture/native/addon/build/performance'}
try:
    receipt.update(sourceAfter=sources(), headAfter=git(['rev-parse', 'HEAD']), statusAfter=git(['status', '--porcelain']), nodeSha256After=sha(NODE), helperSha256After=sha(HELPER))
    receipt['unchanged'] = receipt['sourceAfter'] == before and receipt['headAfter'] == head and receipt['statusAfter'] == status and receipt['nodeSha256After'] == node_sha and receipt['helperSha256After'] == helper_sha
    receipt['status'] = 'PASS' if code == 0 and not timeout and receipt['unchanged'] else 'FAIL'
except Exception as error:
    receipt['afterError'] = repr(error)
(OUT / 'exit.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({k: receipt[k] for k in ['status', 'returncode', 'timeout', 'wallSeconds']}, sort_keys=True))
raise SystemExit(0 if receipt['status'] == 'PASS' else 1)
