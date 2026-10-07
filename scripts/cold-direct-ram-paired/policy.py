"""Closed fresh-child timing schedule and quantitative gate; no guest runs here."""
import json,math
from pathlib import Path

CONTRACT=json.loads((Path(__file__).parent/'contract.json').read_text())
ARMS={'direct-v-companion':('companion','direct'),
      'direct-v-plain-js':('plain-js','direct')}

def require(value,why):
    if not value:raise ValueError(why)

def schedule(comparison):
    require(comparison in ARMS,'closed comparison')
    require(CONTRACT['schedule']=={'warmupPairs':2,'measuredPairs':7,
            'alternating':True,'firstBaseline':True},'closed protocol')
    baseline,candidate=ARMS[comparison]
    return [{'pair':i,'phase':'warmup' if i<2 else 'measured',
             'measuredPair':None if i<2 else i-2,
             'order':[baseline,candidate] if i%2==0 else [candidate,baseline]}
            for i in range(9)]

def checked_timing(receipt):
    t=receipt['executionTiming']
    require(type(t)==dict and set(t)=={'cpuMicroseconds','wallNanoseconds','scope'},'timing fields')
    cpu=t['cpuMicroseconds'];require(type(cpu)==dict and set(cpu)=={'user','system'},'CPU fields')
    for value in cpu.values():require(type(value)==int and 0<=value<=10**12,'CPU units')
    wall=t['wallNanoseconds'];require(type(wall)==str and wall.isascii() and wall.isdecimal()
                                and 0<int(wall)<=10**15,'positive wall units')
    require(type(t['scope'])==str and 20<=len(t['scope'])<=700,'execution scope')
    return {'cpuMicroseconds':cpu['user']+cpu['system'],
            'wallNanoseconds':int(wall)}

def summarize(comparison,pairs):
    expected=schedule(comparison)
    require(len(pairs)==len(expected),'exact nine pairs')
    baseline,candidate=ARMS[comparison]
    measured=[]
    for wanted,actual in zip(expected,pairs):
        require({k:actual[k] for k in ('pair','phase','measuredPair','order')}==wanted,'schedule/order')
        require(set(actual['arms'])=={baseline,candidate},'both arms')
        for arm in (baseline,candidate):
            result=actual['arms'][arm]
            require(result['semantic']=='PASS' and result['closed'] is True,'semantic before timing')
            checked_timing(result['receipt'])
            child=result['wholeChild']
            require(child['exitCode']==0 and child['timedOut'] is False,'complete child')
            require(type(child['cpuSeconds']) in (int,float) and math.isfinite(child['cpuSeconds']) and child['cpuSeconds']>0,'whole CPU')
            require(type(child['wallSeconds']) in (int,float) and math.isfinite(child['wallSeconds']) and child['wallSeconds']>0,'whole wall')
            require(checked_timing(result['receipt'])['cpuMicroseconds']>0,'positive execution CPU')
        if actual['phase']=='measured':measured.append(actual)
    require(len(measured)==7,'seven measured pairs')
    base=sum(checked_timing(p['arms'][baseline]['receipt'])['cpuMicroseconds'] for p in measured)
    direct=sum(checked_timing(p['arms'][candidate]['receipt'])['cpuMicroseconds'] for p in measured)
    require(base>0 and direct>0,'positive execution CPU')
    favorable=all(checked_timing(p['arms'][candidate]['receipt'])['cpuMicroseconds']<
                  checked_timing(p['arms'][baseline]['receipt'])['cpuMicroseconds'] for p in measured)
    ratios=[]
    for p in measured:
        b=p['arms'][baseline];d=p['arms'][candidate]
        bt=checked_timing(b['receipt']);dt=checked_timing(d['receipt'])
        ratios.append({'pair':p['measuredPair'],
          'executionCpuCandidateOverBaseline':dt['cpuMicroseconds']/bt['cpuMicroseconds'],
          'executionWallCandidateOverBaseline':dt['wallNanoseconds']/bt['wallNanoseconds'],
          'wholeChildCpuCandidateOverBaseline':d['wholeChild']['cpuSeconds']/b['wholeChild']['cpuSeconds'],
          'wholeChildWallCandidateOverBaseline':d['wholeChild']['wallSeconds']/b['wholeChild']['wallSeconds']})
    return {'comparison':comparison,'baseline':baseline,'candidate':candidate,
      'measuredPairs':7,'baselineMeanExecutionCpuSeconds':base/7e6,
      'candidateMeanExecutionCpuSeconds':direct/7e6,'meanCpuReduction':1-direct/base,
      'allSevenFavorable':favorable,'quantitativeGatePass':10*direct<=9*base and favorable if comparison=='direct-v-plain-js' else None,
      'interpretation':'adoption gate' if comparison=='direct-v-plain-js' else 'descriptive same-host companion comparison',
      'rawRatios':ratios,'scope':'Same-host fixed free BIOS slice; configured clocks are not physical 386 calibration'}
