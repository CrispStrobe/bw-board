"""Kaggle CPU/GPU runner for the source bundle described in docs/X86-RTX-PLATFORMS.md.

The script kernel uploads only this file. Attach a dataset containing
bw-board-x86-bench.tar.gz; a CPU worker need not have network access.
"""
import json
import os
from pathlib import Path
import subprocess
import tarfile

matches = list(Path('/kaggle/input').rglob('bw-board-x86-bench.tar.gz'))
if len(matches) != 1:
    raise RuntimeError(f'expected exactly one source bundle, found {len(matches)}')
bundle = matches[0]
work = Path('/kaggle/working/bw-board-x86-bench')
work.mkdir(parents=True, exist_ok=True)
with tarfile.open(bundle, 'r:gz') as archive:
    if any(not (work / member.name).resolve().is_relative_to(work.resolve())
           for member in archive.getmembers()):
        raise RuntimeError('unsafe source archive path')
    archive.extractall(work)

gpu = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
                     capture_output=True, text=True, check=False)
gpu_name = gpu.stdout.strip() if gpu.returncode == 0 else None
env = dict(os.environ, KAGGLE_GPU_MODEL=gpu_name or '',
           BENCH_SOURCE_REVISION=(work / 'source-revision.txt').read_text().strip())
node = subprocess.run(['node', '--version'], capture_output=True, text=True)
if node.returncode:
    raise RuntimeError('Kaggle image has no Node; install Node before running this benchmark')
result = subprocess.run(['node', 'scripts/bench-x86-platforms.mjs', '--steps', '1000000',
                         '--passes', '3'], cwd=work, env=env, text=True,
                        capture_output=True, check=True)
report = json.loads(result.stdout)
report['kaggle'] = {'gpuAttached': bool(gpu_name), 'gpuModel': gpu_name,
                    'gpuUsedByBenchmark': False, 'sourceBundle': str(bundle)}
output = Path('/kaggle/working/x86-rtx-result.json')
output.write_text(json.dumps(report, indent=2) + '\n')
print(output.read_text(), flush=True)
