#!/usr/bin/env python3
"""Synthetic parser adversaries; no emulator or sampled guest."""
import copy, hashlib, json, tempfile
from pathlib import Path
from profile import load, bucket, source_roles

def denied(path, obj):
    path.write_text(json.dumps(obj))
    try: load(path)
    except (ValueError, TypeError): return
    raise AssertionError('malformed CPU profile admitted')

with tempfile.TemporaryDirectory() as temporary:
    path=Path(temporary)/'profile.json'
    valid={'nodes':[
      {'id':1,'callFrame':{'functionName':'(root)','url':'','scriptId':'0','lineNumber':-1,'columnNumber':-1},'children':[2]},
      {'id':2,'callFrame':{'functionName':'work','url':'file:///exact.js','scriptId':'1','lineNumber':0,'columnNumber':0}}],
      'samples':[2,2], 'timeDeltas':[1000,1000], 'startTime':100000,'endTime':103000}
    path.write_text(json.dumps(valid));assert load(path)[2:5]==(2000,0,1000)
    signed=copy.deepcopy(valid);signed['timeDeltas']=[1000,-53,1000];signed['samples']=[2]*3
    path.write_text(json.dumps(signed));assert load(path)[2:5]==(1947,1,-53)
    for mutate in (
      lambda x:x.update(timeDeltas=[-1,2000]),
      lambda x:x.update(timeDeltas=[4000,1]),
      lambda x:x.update(samples=[2]),
      lambda x:x['nodes'][0].update(children=[2,2]),
      lambda x:x['nodes'][1].update(children=[1]),
      lambda x:x['nodes'][1].update(id=1),
      lambda x:x['nodes'][1]['callFrame'].update(scriptId='bad'),
      lambda x:x['nodes'][1]['callFrame'].update(lineNumber=True),
      lambda x:x.update(startTime=-1),
    ):
      case=copy.deepcopy(valid);mutate(case);denied(path,case)
    mapping={'file:///exact.js':'generated-profile-probe'}
    assert bucket(valid['nodes'][1]['callFrame'],mapping)=='profiled_probe_js'
    assert bucket({**valid['nodes'][1]['callFrame'],'url':'file:///wrong.js'},mapping)=='native_wasm_or_unresolved'
    assert bucket({'url':'','functionName':'garbage collector'},mapping)=='native_wasm_or_unresolved'
    assert bucket({'url':'','functionName':'(garbage collector)'},mapping)=='v8_gc'
    source=Path(temporary)/'source';(source/'scripts').mkdir(parents=True)
    (source/'src').mkdir();(source/'src/x.js').write_bytes(b'export default 1;')
    generated=source/'scripts/probe-xv6-stock-profile.mjs';generated.write_bytes(b'profile')
    h=lambda body:hashlib.sha256(body).hexdigest()
    inventory={'../src/x.js':h(b'export default 1;')}
    assert source_roles(source,inventory,h(b'profile'))[(source/'src/x.js').as_uri()]=='../src/x.js'
    (source/'src/link.js').symlink_to(source/'src/x.js')
    try:source_roles(source,{'../src/link.js':inventory['../src/x.js']},h(b'profile'))
    except ValueError:pass
    else:raise AssertionError('source symlink admitted')
    try:source_roles(source,inventory,'0'*64)
    except ValueError:pass
    else:raise AssertionError('wrong generated source admitted')
    print('profile-control PASS')
