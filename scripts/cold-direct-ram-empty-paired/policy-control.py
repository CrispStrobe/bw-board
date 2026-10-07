"""No guest: reject timing before semantic/closure/resource admission."""
import copy
from policy import schedule,summarize

def arm(cpu):
    return {'semantic':'PASS','closed':True,'receipt':{
      'executionTiming':{'cpuMicroseconds':{'user':cpu,'system':0},'wallNanoseconds':str(cpu*1000)},
      'startupTiming':{'cpuMicroseconds':{'user':100,'system':0},'elapsedMilliseconds':1}},
      'wholeChild':{'exitCode':0,'timedOut':False,'rssExceeded':False,
        'processGroupEmptyAfterExit':True,'childMaxRssKilobytes':1024,
        'cpuSeconds':(cpu+1000)/1e6,'wallSeconds':(cpu*1000+2000000)/1e9}}
def pairs(name,baseline=10000,candidate=8000):
    out=[]
    for row in schedule(name):
        b,c=('plain-js','candidate') if name=='candidate-v-plain-js' else ('baseline','candidate')
        out.append({**row,'arms':{b:arm(baseline),c:arm(candidate)}})
    return out
def denies(fn):
    try:fn()
    except (ValueError,KeyError,TypeError,ZeroDivisionError):return
    raise AssertionError('malformed timing admitted')

assert len(schedule('candidate-v-baseline'))==len(schedule('candidate-v-plain-js'))==9
assert [p['order'] for p in schedule('candidate-v-baseline')][:2]==[
    ['baseline','candidate'],['candidate','baseline']]
assert summarize('candidate-v-baseline',pairs('candidate-v-baseline'))['quantitativeGatePass'] is None
assert summarize('candidate-v-plain-js',pairs('candidate-v-plain-js'))['quantitativeGatePass'] is True
assert summarize('candidate-v-plain-js',pairs('candidate-v-plain-js',10000,9500))['quantitativeGatePass'] is False
for edit in (
 lambda p:p[0]['arms']['candidate'].__setitem__('semantic','FAIL'),
 lambda p:p[0]['arms']['candidate'].__setitem__('closed',False),
 lambda p:p[0]['arms']['candidate']['wholeChild'].__setitem__('childMaxRssKilobytes',2*1024*1024),
 lambda p:p[0]['arms']['candidate']['wholeChild'].__setitem__('cpuSeconds',float('inf')),
 lambda p:p[0]['arms']['candidate']['receipt']['executionTiming'].__setitem__('wallNanoseconds','0'),
 lambda p:p[0]['arms']['candidate']['receipt']['executionTiming']['cpuMicroseconds'].__setitem__('user',0),
 lambda p:p[0].__setitem__('order',['candidate','baseline']),
 lambda p:p.pop(),
):
    candidate=copy.deepcopy(pairs('candidate-v-baseline'));edit(candidate)
    denies(lambda:summarize('candidate-v-baseline',candidate))
print('policy controls PASS: separate descriptive/adoption gates and malformed resource/semantic denial')
