"""Bounded schedule and failure-gate controls; no addon or guest."""
from copy import deepcopy
from policy import schedule,summarize

def child(cpu):
    return {'semantic':'PASS','closed':True,
      'receipt':{'executionTiming':{'cpuMicroseconds':{'user':cpu,'system':0},
                'wallNanoseconds':str(cpu*1000),
                'scope':'Synthetic control interval, never a guest measurement'}},
      'wholeChild':{'exitCode':0,'timedOut':False,'cpuSeconds':cpu/1e6+0.01,'wallSeconds':cpu/1e6+0.02}}

for name,arms in [('direct-v-companion',('companion','direct')),
                  ('direct-v-plain-js',('plain-js','direct'))]:
    pairs=[{**p,'arms':{arms[0]:child(100),arms[1]:child(80)}} for p in schedule(name)]
    result=summarize(name,pairs)
    assert result['quantitativeGatePass'] and result['allSevenFavorable']
    bad=deepcopy(pairs);bad[3]['arms']['direct']['semantic']='FAIL'
    try:summarize(name,bad)
    except ValueError:pass
    else:raise AssertionError('unqualified child admitted to timing')
    bad=deepcopy(pairs);bad[4]['order'].reverse()
    try:summarize(name,bad)
    except ValueError:pass
    else:raise AssertionError('nonalternating order admitted')
    slow=deepcopy(pairs);slow[5]['arms']['direct']=child(101)
    result=summarize(name,slow)
    assert not result['quantitativeGatePass'] and not result['allSevenFavorable']
print('direct-RAM paired policy controls PASS')
