"""Synthetic controls only; no actual profile, Inspector, addon, or guest."""
import importlib.util,copy
from pathlib import Path
s=importlib.util.spec_from_file_location('prepared',Path(__file__).with_name('analyze.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def frame(name,url=''):return dict(functionName=name,url=url,scriptId='1',lineNumber=0,columnNumber=0)
def node(i,name,children=[],url=''):return dict(id=i,callFrame=frame(name,url),children=children)
u='file:///owned/profile-runner.mjs'
p=dict(startTime=100,endTime=200,nodes=[node(1,'(root)',[2,5,6,7]),node(2,'resume',[3],u),node(3,'resume',[4],u),node(4,'close'),node(5,'(program)'),node(6,'(garbage collector)'),node(7,'(idle)')],samples=[4,5,6,7],timeDeltas=[20,20,20,20])
ph=dict(zip(['setupBeginUs','startCallBeginUs','startCallEndUs','executionBeginUs','executionEndUs','stopCallBeginUs','stopCallEndUs'],[90,95,100,110,190,191,201]))
r=m.analyze(p,ph,u);assert r['selectedIndices']==[0,1,2,3];assert sum(x['samples']for x in r['mutuallyExclusiveLeaves'])==4
assert next(x for x in r['inclusiveFunctions']if x['functionName']=='resume')['samples']==1
assert r['leafCategories']=={'native-shared-invoke-alias-under-resume':1,'program':1,'garbage-collector':1,'idle':1}
def deny(change):
 q=copy.deepcopy(p);change(q)
 try:m.analyze(q,ph,u)
 except (AssertionError,KeyError,TypeError):return
 raise AssertionError('malformed profile admitted')
attacks=[lambda q:q['timeDeltas'].pop(),lambda q:q['timeDeltas'].__setitem__(0,-1),lambda q:q['samples'].__setitem__(0,99),lambda q:q['nodes'][0]['children'].append(99),lambda q:q['nodes'][3]['children'].append(2),lambda q:q['nodes'][4]['children'].append(4),lambda q:q.__setitem__('startTime',True),lambda q:q['timeDeltas'].__setitem__(0,2**53),lambda q:q['nodes'][0]['children'].remove(7)]
for attack in attacks:deny(attack)
q=copy.deepcopy(p);q['nodes'][3]['callFrame']['url']='file:///real-js.mjs';assert m.analyze(q,ph,u)['leafCategories']['javascript-frame']==1
bad=dict(ph,executionBeginUs=185,executionEndUs=190)
try:m.analyze(p,bad,u)
except AssertionError:pass
else:raise AssertionError('empty selection admitted')
print('SYNTHETIC_SOURCE_CONTROLS_PASS: partition, recursive dedup, categories, 9 malformed profiles, JS close, empty window')
