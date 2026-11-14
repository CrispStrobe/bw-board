import pathlib,json,statistics,math,hashlib
p=pathlib.Path(__file__).resolve().parent
samples=json.loads((p/'samples.json').read_text());summary=json.loads((p/'summary.json').read_text());metadata=json.loads((p/'metadata.json').read_text())
assert len(samples)==27
assert all(s['semantic']==samples[0]['semantic'] for s in samples)
assert all(s['steps']==9999999 and s['warmupSteps']==25000 and s['semantic']['retired']==9999999 for s in samples)
assert all(0<s['stats']['instructions']<=9999999 for s in samples if s['arm']!='ordinary')
for s in samples:
 raw=json.loads((p/f"round-{s['round']}-{s['arm']}.stdout").read_text());assert raw['semantic']==s['semantic']
 assert (p/f"round-{s['round']}-{s['arm']}.stderr").read_bytes()==b''
for arm in ['ordinary','dispatch','candidate']:
 for key in ['wholeCpuSeconds','wholeWallSeconds','executionCpuSeconds','executionWallSeconds']:
  mean=statistics.mean(s[key] for s in samples if s['measured'] and s['arm']==arm)
  assert math.isclose(mean,summary['means'][arm][key],rel_tol=1e-12)
for key,ratio in summary['ratios'].items():
 assert math.isclose(ratio['candidateOverDispatch'],summary['means']['candidate'][key]/summary['means']['dispatch'][key],rel_tol=1e-12)
 assert math.isclose(ratio['dispatchOverOrdinary'],summary['means']['dispatch'][key]/summary['means']['ordinary'][key],rel_tol=1e-12)
print(json.dumps({'pass':True,'children':27,'measuredPairs':7,'semanticEquality':True,'ratios':summary['ratios']}))
