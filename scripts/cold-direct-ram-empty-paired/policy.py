"""Closed timing policy. Semantic admission is a prerequisite, never an input flag alone."""
import math

COMPARISONS={'candidate-v-baseline':('baseline','candidate'),
             'candidate-v-plain-js':('plain-js','candidate')}
def require(value,reason):
    if not value:raise ValueError(reason)
def schedule(name):
    require(name in COMPARISONS,'closed comparison')
    baseline,candidate=COMPARISONS[name]
    return [{'pair':i,'phase':'warmup' if i<2 else 'measured',
             'measuredPair':None if i<2 else i-2,
             'order':[baseline,candidate] if i%2==0 else [candidate,baseline]}
            for i in range(9)]
def metric(arm):
    require(arm['semantic']=='PASS' and arm['closed'] is True,'semantic and closure before timing')
    receipt=arm['receipt'];whole=arm['wholeChild']
    require(whole['exitCode']==0 and whole['timedOut'] is False and
            whole['rssExceeded'] is False and whole['processGroupEmptyAfterExit'] is True,
            'bounded child completed')
    require(whole['childMaxRssKilobytes']*1024<=1536*1024**2,'post-reap RSS bound')
    for key in ('cpuSeconds','wallSeconds'):
        v=whole[key];require(type(v) in (int,float) and math.isfinite(v) and v>0,'whole '+key)
    timing=receipt['executionTiming'];cpu=timing['cpuMicroseconds']
    require(set(cpu)=={'user','system'} and all(type(x)==int and 0<=x<=10**12 for x in cpu.values()),
            'execution CPU units')
    execution_cpu=sum(cpu.values());require(execution_cpu>0,'positive execution CPU')
    wall=timing['wallNanoseconds']
    require(type(wall)==str and wall.isascii() and wall.isdecimal() and 0<int(wall)<=10**15,
            'execution wall units')
    startup=receipt['startupTiming'];startup_cpu=startup['cpuMicroseconds']
    require(set(startup_cpu)=={'user','system'} and
            all(type(x)==int and 0<=x<=10**12 for x in startup_cpu.values()),'startup CPU units')
    require(type(startup['elapsedMilliseconds'])==int and startup['elapsedMilliseconds']>=0,
            'startup wall units')
    require(sum(startup_cpu.values())+execution_cpu<=whole['cpuSeconds']*1e6+10000,
            'CPU windows fit whole child')
    require(startup['elapsedMilliseconds']*1e6+int(wall)<=whole['wallSeconds']*1e9+50000000,
            'wall windows fit whole child')
    return {'executionCpuMicroseconds':execution_cpu,'executionWallNanoseconds':int(wall),
            'wholeCpuSeconds':whole['cpuSeconds'],'wholeWallSeconds':whole['wallSeconds']}
def summarize(name,pairs):
    expected=schedule(name);require(len(pairs)==9,'nine pairs')
    baseline,candidate=COMPARISONS[name];measured=[]
    for got,want in zip(pairs,expected):
        require({key:got[key] for key in want}==want,'exact alternating schedule')
        require(set(got['arms'])=={baseline,candidate},'two exact arms')
        for arm in (baseline,candidate):metric(got['arms'][arm])
        if got['phase']=='measured':measured.append(got)
    b=[metric(p['arms'][baseline]) for p in measured]
    c=[metric(p['arms'][candidate]) for p in measured]
    base=sum(x['executionCpuMicroseconds'] for x in b)
    cand=sum(x['executionCpuMicroseconds'] for x in c)
    favorable=sum(y['executionCpuMicroseconds']<x['executionCpuMicroseconds'] for x,y in zip(b,c))
    adoption=name=='candidate-v-plain-js'
    return {'comparison':name,'baseline':baseline,'candidate':candidate,'measuredPairs':7,
      'baselineMeanExecutionCpuSeconds':base/7e6,'candidateMeanExecutionCpuSeconds':cand/7e6,
      'meanCpuReduction':1-cand/base,'favorablePairs':favorable,
      'quantitativeGatePass':(10*cand<=9*base and favorable==7) if adoption else None,
      'interpretation':'adoption gate' if adoption else 'causal provider variant comparison',
      'ratios':[{'pair':i,'executionCpuCandidateOverBaseline':y['executionCpuMicroseconds']/x['executionCpuMicroseconds'],
                 'executionWallCandidateOverBaseline':y['executionWallNanoseconds']/x['executionWallNanoseconds'],
                 'wholeCpuCandidateOverBaseline':y['wholeCpuSeconds']/x['wholeCpuSeconds'],
                 'wholeWallCandidateOverBaseline':y['wholeWallSeconds']/x['wholeWallSeconds']}
                for i,(x,y) in enumerate(zip(b,c))]}
