import hashlib, json, os, pathlib, resource, signal, subprocess, time
ROOT = pathlib.Path('/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-parity-results-20261002')
OUT = pathlib.Path('/tmp/native-cold-bios-js-authenticated-baseline-20261003')
NODE = pathlib.Path('/tmp/node-v22.23.3-linux-x64/bin/node')
HEAD = '60a9b11ab480531e692dbac70ecbb35430cf425d'
INVENTORY = pathlib.Path('/tmp/native-cold-bios-reference-pure-controls-r2-20261003/invocation.json')
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT)
def source_map(paths): return {p: sha(ROOT / p) for p in paths}
def git_map(paths): return {p: hashlib.sha256(git('show', HEAD + ':' + p)).hexdigest() for p in paths}
def safe(fn):
    try: return {'value': fn()}
    except Exception as error: return {'error': repr(error)}
def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 << 20, 8 << 20))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.nice(10)
OUT.mkdir(exist_ok=False)
assert sha(INVENTORY) == '4daf3df89585342111613f0ba9e14533124aacb2e3a18b70cb1773b0343efa16'
paths = sorted(json.loads(INVENTORY.read_text())['sourceBefore'])
assert len(paths) == 48
before = source_map(paths)
before_git = git_map(paths)
before_head = git('rev-parse', 'HEAD').decode().strip()
before_status = git('status', '--porcelain').decode()
helpers_before = {str(p): sha(p) for p in [NODE, pathlib.Path(__file__), INVENTORY]}
assert before_head == HEAD and not before_status and before == before_git
assert helpers_before[str(NODE)] == 'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
blank = dict.fromkeys(['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'BW_HOT_NAPI_PROFILE', 'NODE_V8_COVERAGE'], '')
env = os.environ.copy()
env.update(blank)
env['BW_COLD_REFERENCE_OUTPUT'] = str(OUT / 'baseline.json')
command = [str(NODE), '--max-old-space-size=128', '--test', 'test/i80386-cold-bios-reference-source.test.mjs']
invocation = {'command': command, 'cpuSeconds': 15, 'wallSeconds': 30, 'heapMiB': 128, 'fileBytes': 8 << 20, 'coreBytes': 0, 'niceIncrement': 10, 'blankEnvironment': blank, 'baselineOutput': env['BW_COLD_REFERENCE_OUTPUT'], 'scope': 'Seven pure source controls and ONE ordinary JS cold baseline; no native addon/build/performance', 'sourceBefore': before, 'gitBefore': before_git, 'headBefore': before_head, 'statusBefore': before_status, 'helpersBefore': helpers_before}
(OUT / 'invocation.json').write_text(json.dumps(invocation, indent=2) + '\n')
start = time.monotonic()
timed_out = False
with (OUT / 'stdout.txt').open('wb') as stdout, (OUT / 'stderr').open('wb') as stderr:
    child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, preexec_fn=limits, start_new_session=True)
    try: exit_code = child.wait(timeout=30)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(child.pid, signal.SIGKILL)
        exit_code = child.wait()
receipt = {'exitCode': exit_code, 'timedOut': timed_out, 'elapsedSeconds': time.monotonic() - start, 'sourceAfter': safe(lambda: source_map(paths)), 'gitAfter': safe(lambda: git_map(paths)), 'headAfter': safe(lambda: git('rev-parse', 'HEAD').decode().strip()), 'statusAfter': safe(lambda: git('status', '--porcelain').decode()), 'helpersAfter': safe(lambda: {str(p): sha(p) for p in [NODE, pathlib.Path(__file__), INVENTORY]}), 'stdoutSha256': sha(OUT / 'stdout.txt'), 'stderrSha256': sha(OUT / 'stderr')}
(OUT / 'exit.json').write_text(json.dumps(receipt, indent=2) + '\n')
assert exit_code == 0 and not timed_out
assert receipt['sourceAfter'] == {'value': before} and receipt['gitAfter'] == {'value': before_git}
assert receipt['headAfter'] == {'value': before_head} and receipt['statusAfter'] == {'value': before_status}
assert receipt['helpersAfter'] == {'value': helpers_before}
actual = json.loads((OUT / 'baseline.json').read_text())
assert actual['status'] == 'PASS'
assert actual['sourceBefore'] == actual['sourceAfter'] == {'revision': HEAD, 'hashes': before}
assert actual['nodeSha256Before'] == actual['nodeSha256After'] == helpers_before[str(NODE)]
tap = (OUT / 'stdout.txt').read_text()
assert '# pass 8' in tap and '# fail 0' in tap and '# skipped 0' in tap
reference = actual['reference']
summary = {'status': 'PASS_FIRST_AUTHENTICATED_ORDINARY_JS_COLD_BASELINE', 'head': HEAD, 'sourceInputs': len(paths), 'elapsedSeconds': receipt['elapsedSeconds'], 'scope': invocation['scope'], 'baselineSha256': sha(OUT / 'baseline.json'), 'q': reference['q'], 'pioEvents': len(reference['ports']), 'namedCuts': len(reference['cuts']), 'repElements': sum(len(r['elements']) for r in reference['reps']), 'codePages': reference['codePages'], 'ramSha256': reference['final']['ramSha256']}
(OUT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
