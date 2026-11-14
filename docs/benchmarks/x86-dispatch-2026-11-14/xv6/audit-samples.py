"""Recompute published numeric samples; does not execute or qualify a guest."""
import json
import math
from pathlib import Path
from statistics import mean

root = Path(__file__).resolve().parent
rows = json.loads((root / 'samples.json').read_text())
summary = json.loads((root / 'summary.json').read_text())
arms = {'candidate', 'dispatch', 'candidate-ordinary', 'ordinary'}
assert len(rows) == 36
assert {(r['index'], r['arm']) for r in rows} == {
    (i, arm) for i in range(9) for arm in arms}
for row in rows:
    assert all(math.isfinite(row[k]) and row[k] > 0
               for k in ['cpuSeconds', 'wallSeconds'])
for metric in ['cpuSeconds', 'wallSeconds']:
    means = {arm: mean(r[metric] for r in rows
                      if r['arm'] == arm and r['index'] >= 2) for arm in arms}
    for arm, value in means.items():
        assert math.isclose(value, summary['means'][arm][metric], rel_tol=1e-12)
    ratio = means['candidate'] / means['dispatch']
    assert math.isclose(ratio, summary['ratios'][metric]['candidateOverDispatch'],
                        rel_tol=1e-12)
    assert ratio <= 0.95
    ordinary_ratio = means['candidate-ordinary'] / means['ordinary']
    assert math.isclose(ordinary_ratio, summary['candidateOrdinaryRatios'][metric],
                        rel_tol=1e-12)
    for candidate, baseline, field in [
            ('candidate', 'dispatch', 'favorablePairs'),
            ('candidate-ordinary', 'ordinary', 'favorableCandidateOrdinaryPairs')]:
        values = {(r['index'], r['arm']): r[metric] for r in rows}
        favorable = sum(values[i, candidate] < values[i, baseline]
                        for i in range(2, 9))
        assert favorable == summary[field][metric]
    print(f'{metric}: ratio {ratio:.9f}, reduction {(1-ratio)*100:.4f}%')
print('Numeric samples PASS; guest correctness is a separately recorded audit.')
