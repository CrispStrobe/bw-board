"""Validate a bounded V8 CPU profile and summarize observed samples only."""
import base64,hashlib,json,math,re
from pathlib import Path
from urllib.parse import urlparse,unquote

MAX_BYTES=16*1024*1024
MAX_NODES=100000
MAX_SAMPLES=250000
MAX_MICROSECONDS=360*1000000

def require(ok,message):
    if not ok:raise ValueError(message)

def number(value):return type(value) in (int,float) and math.isfinite(value)

def load(path):
    p=Path(path);require(p.is_file() and 0<p.stat().st_size<=MAX_BYTES,'bounded profile bytes')
    profile=json.loads(p.read_bytes())
    require(type(profile) is dict and set(('nodes','samples','timeDeltas','startTime','endTime'))<=set(profile),'profile fields')
    nodes,samples,deltas=profile['nodes'],profile['samples'],profile['timeDeltas']
    require(type(nodes) is list and 1<=len(nodes)<=MAX_NODES,'bounded profile nodes')
    require(type(samples) is list and 1<=len(samples)<=MAX_SAMPLES and
            type(deltas) is list and len(deltas)==len(samples),'bounded complete samples')
    start,end=profile['startTime'],profile['endTime']
    require(number(start) and number(end) and start>=0 and
            0<end-start<=MAX_MICROSECONDS,'positive bounded profile window')
    by_id={};parents={}
    for node in nodes:
        require(type(node) is dict and type(node.get('id')) is int and node['id']>0 and
                node['id'] not in by_id,'unique positive node id')
        frame=node.get('callFrame');children=node.get('children',[])
        require(type(frame) is dict and type(frame.get('functionName')) is str and
                type(frame.get('url')) is str and len(frame['functionName'])<=1024 and
                len(frame['url'])<=MAX_BYTES and
                type(frame.get('scriptId')) is str and
                re.fullmatch(r'[0-9]{1,20}',frame['scriptId']) is not None and
                type(frame.get('lineNumber')) is int and -1<=frame['lineNumber']<=100000000 and
                type(frame.get('columnNumber')) is int and -1<=frame['columnNumber']<=100000000 and
                type(children) is list and
                len(children)<=MAX_NODES,'bounded call frame and children')
        by_id[node['id']]=node
    for node in nodes:
        children=node.get('children',[])
        require(len(children)==len(set(children)),'duplicate child edge')
        for child in children:
            require(type(child) is int and child in by_id and child!=node['id'] and
                    child not in parents,'valid single-parent graph')
            parents[child]=node['id']
    roots=set(by_id)-set(parents);require(len(roots)==1,'one profile root')
    root=next(iter(roots));require(root==nodes[0]['id'],'first profile node is root')
    visited=set();active=set();stack=[(root,False)]
    while stack:
        node_id,leaving=stack.pop()
        if leaving:
            active.remove(node_id);visited.add(node_id);continue
        require(node_id not in active,'profile cycle')
        if node_id in visited:continue
        active.add(node_id);stack.append((node_id,True))
        stack.extend((child,False) for child in reversed(by_id[node_id].get('children',[])))
    require(len(visited)==len(by_id),'all profile nodes reachable')
    total=0
    for sample,delta in zip(samples,deltas):
        require(type(sample) is int and sample in by_id,'sample references node')
        require(type(delta) is int and 0<=delta<=MAX_MICROSECONDS,'nonnegative bounded delta')
        total+=delta
    require(0<total<=MAX_MICROSECONDS,'positive bounded sampled duration')
    # CDP timeDeltas start at profile start, then count between samples. The
    # last sample precedes stop; one configured 1000-us sample interval covers
    # possible timestamp rounding at the end.
    require(total<=end-start+1000,'sampled duration within profile window')
    return profile,by_id,parents,total

def role(url,context,cache):
    if url in cache:return cache[url]
    result='unresolved'
    if url.startswith('data:text/javascript;base64,'):
        try:
            data=base64.b64decode(url.split(',',1)[1],validate=True)
            if hashlib.sha256(data).hexdigest()==context.get('providerLoadedSha256'):
                result='authenticated_provider'
        except (ValueError,base64.binascii.Error):pass
    elif url.startswith('file:'):
        parsed=urlparse(url)
        if parsed.netloc in ('','localhost') and not parsed.query and not parsed.fragment:
            path=Path(unquote(parsed.path))
            provider=context.get('providerFile')
            if provider is not None and path==Path(provider):
                try:
                    if (url==Path(provider).as_uri() and not path.is_symlink() and
                        path.resolve(strict=True)==path and path.is_file() and
                        0<path.stat().st_size<=1024*1024 and
                        hashlib.sha256(path.read_bytes()).hexdigest()==context['providerLoadedSha256']):
                        result='authenticated_provider'
                except (FileNotFoundError,RuntimeError,ValueError):pass
            else:
                for key,label in (('qualifiedRoot','qualified'),('derivedRoot','derived'),
                                  ('harnessRoot','harness')):
                    root=Path(context[key])
                    try:
                        if path.resolve(strict=True).is_relative_to(root.resolve(strict=True)) and path.is_file():
                            result=label;break
                    except (FileNotFoundError,RuntimeError):pass
    elif url.startswith('node:'):result='node_runtime'
    cache[url]=result;return result

def classify(node_id,by_id,parents,context,cache):
    node=by_id[node_id];frame=node['callFrame'];name=frame['functionName'];url=frame['url']
    if url=='' and name in ('(garbage collector)','(GC)'):return 'v8_gc'
    # A native sample may retain JS ancestors; a blank leaf URL is unresolved.
    leaf_role=role(url,context,cache)
    if leaf_role=='unresolved':return 'native_or_unresolved'
    chain=[];current=node_id
    while current in by_id:
        frame=by_id[current]['callFrame']
        chain.append((frame['functionName'],role(frame['url'],context,cache)))
        if current not in parents:break
        current=parents[current]
    if ('reconcile','authenticated_provider') in chain:return 'js_reconcile'
    if ('clockTransfer','authenticated_provider') in chain or ('clockTransfer','qualified') in chain:
        return 'js_clock_callback'
    if any((name,'qualified') in chain for name in ('nativeTick','quantum','stageLine','beginRun',
                                                   'endRun','inPort','outPort','settleTerminal')):
        return 'js_board_device'
    return 'other_js'

def summarize(path,context):
    require(type(context) is dict and all(key in context for key in
            ('providerLoadedSha256','qualifiedRoot','harnessRoot','derivedRoot')),
            'authenticated profile source roles')
    profile,by_id,parents,total=load(path)
    counts={key:{'samples':0,'sampledDeltaMicroseconds':0} for key in
            ('js_reconcile','js_clock_callback','js_board_device','other_js',
             'v8_gc','native_or_unresolved')}
    cache={}
    for sample,delta in zip(profile['samples'],profile['timeDeltas']):
        bucket=classify(sample,by_id,parents,context,cache)
        counts[bucket]['samples']+=1;counts[bucket]['sampledDeltaMicroseconds']+=delta
    for bucket in counts.values():
        bucket['fractionOfSamples']=bucket['samples']/len(profile['samples'])
        bucket['fractionOfSampledDeltas']=bucket['sampledDeltaMicroseconds']/total
    return {'schema':'bw.cold-direct-ram.inspector-samples.v1',
            'scope':'diagnostic V8 execution-scope samples, not adoption timing or precise CPU cost share',
            'nodeCount':len(by_id),'sampleCount':len(profile['samples']),
            'profileWindowMicroseconds':profile['endTime']-profile['startTime'],
            'sampledDeltaMicroseconds':total,
            'unassignedOrNativeSamples':counts['native_or_unresolved']['samples'],
            'buckets':counts,
            'resolvedUrlRoles':{value:sum(1 for role_name in cache.values() if role_name==value)
             for value in ('authenticated_provider','qualified','derived','harness','node_runtime','unresolved')},
            'limitations':['Blank-URL native/builtin frames remain unresolved even with JS ancestors.',
                           'Reconcile samples do not identify empty versus nonempty batches.',
                           'Sample deltas and profiler bracketing include profiler overhead and do not equal execution CPU.']}
