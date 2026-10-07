"""Strict bounded V8 profile parser; count observed leaves, never infer CPU cost share."""
import hashlib,json,math,re,stat
from pathlib import Path

MAX_BYTES=8*1024*1024
MAX_NODES=100000
MAX_SAMPLES=250000
MAX_WINDOW_US=180*1000000
def require(value,why):
    if not value:raise ValueError(why)
def digest(data):return hashlib.sha256(data).hexdigest()
def finite(value):return type(value) in (int,float) and math.isfinite(value)
def load(path):
    p=Path(path);require(p.is_file() and not p.is_symlink() and 0<p.stat().st_size<=MAX_BYTES,
                    'bounded ordinary CPU profile')
    raw=p.read_bytes()
    def unique(pairs):
        result={}
        for key,value in pairs:
            require(key not in result,'duplicate CPU profile JSON key')
            result[key]=value
        return result
    def nonfinite(value):raise ValueError('nonfinite CPU profile JSON constant: '+value)
    profile=json.loads(raw,object_pairs_hook=unique,parse_constant=nonfinite)
    require(type(profile)==dict and {'nodes','samples','timeDeltas','startTime','endTime'}<=profile.keys(),
            'complete CPU profile fields')
    nodes=profile['nodes'];samples=profile['samples'];deltas=profile['timeDeltas']
    require(type(nodes)==list and 1<=len(nodes)<=MAX_NODES,'bounded profile nodes')
    require(type(samples)==list and 1<=len(samples)<=MAX_SAMPLES and
            type(deltas)==list and len(deltas)==len(samples),'bounded complete samples')
    start,end=profile['startTime'],profile['endTime']
    require(finite(start) and finite(end) and start>=0 and 0<end-start<=MAX_WINDOW_US,
            'bounded positive profile window')
    by_id={};parents={}
    for node in nodes:
        require(type(node)==dict and type(node.get('id'))==int and node['id']>0 and
                node['id'] not in by_id,'unique positive node id')
        frame=node.get('callFrame');children=node.get('children',[])
        require(type(frame)==dict and type(frame.get('functionName'))==str and
                len(frame['functionName'])<=1024 and type(frame.get('url'))==str and
                len(frame['url'])<=4096 and type(frame.get('scriptId'))==str and
                re.fullmatch(r'[0-9]{1,20}',frame['scriptId']) is not None and
                type(frame.get('lineNumber'))==int and -1<=frame['lineNumber']<=100000000 and
                type(frame.get('columnNumber'))==int and -1<=frame['columnNumber']<=100000000 and
                type(children)==list and len(children)<=MAX_NODES,'bounded call frame')
        by_id[node['id']]=node
    for node in nodes:
        children=node.get('children',[])
        require(len(children)==len(set(children)),'duplicate child edge')
        for child in children:
            require(type(child)==int and child in by_id and child!=node['id'] and child not in parents,
                    'valid one-parent graph')
            parents[child]=node['id']
    roots=set(by_id)-set(parents);require(len(roots)==1,'single graph root')
    root=next(iter(roots));require(root==nodes[0]['id'],'first node is root')
    active=set();visited=set();stack=[(root,False)]
    while stack:
        node_id,leaving=stack.pop()
        if leaving:
            active.remove(node_id);visited.add(node_id);continue
        require(node_id not in active,'profile cycle')
        if node_id in visited:continue
        active.add(node_id);stack.append((node_id,True))
        stack.extend((child,False) for child in reversed(by_id[node_id].get('children',[])))
    require(len(visited)==len(by_id),'all nodes reachable')
    total=0;negative=0;minimum=None
    for sample,delta in zip(samples,deltas):
        require(type(sample)==int and sample in by_id,'sample node id')
        require(type(delta)==int and -1000<=delta<=MAX_WINDOW_US,'bounded signed delta')
        negative+=delta<0;minimum=delta if minimum is None else min(minimum,delta)
        total+=delta;require(0<=total<=end-start+1000,'sample timestamp within profile window')
    require(0<total<=MAX_WINDOW_US,'positive sampled span')
    return profile,by_id,total,negative,minimum,digest(raw)
def source_roles(source_root,inventory,generated_sha):
    source=Path(source_root);require(source.is_dir() and source.resolve(strict=True)==source,
                                'canonical exact source checkout')
    require(type(inventory)==dict and 1<=len(inventory)<=256,'bounded source inventory')
    mapping={}
    for role,expected in inventory.items():
        require(type(role)==str and role.startswith(('./','../')) and '\\' not in role and
                '..' not in role.split('/')[1:] and type(expected)==str and len(expected)==64,
                'source role identity')
        lexical=source/'scripts'/role
        info=lexical.lstat()
        require(stat.S_ISREG(info.st_mode) and not lexical.is_symlink(),
                'ordinary source role')
        path=lexical.resolve(strict=True)
        require(path.is_relative_to(source) and path.is_file() and
                path.stat().st_size<=4*1024*1024 and digest(path.read_bytes())==expected,
                'exact authenticated source bytes')
        mapping[path.as_uri()]=role
    generated=source/'scripts/probe-xv6-stock-profile.mjs'
    require(generated.is_file() and not generated.is_symlink() and generated.resolve(strict=True)==generated and
            generated.stat().st_size<=4*1024*1024 and digest(generated.read_bytes())==generated_sha,
            'exact generated sibling bytes')
    require(generated.as_uri() not in mapping,'separate generated role')
    mapping[generated.as_uri()]='generated-profile-probe'
    return mapping
def bucket(frame,mapping):
    url=frame['url'];name=frame['functionName']
    if not url and name in ('(garbage collector)','(GC)'):return 'v8_gc'
    role=mapping.get(url)
    if role=='generated-profile-probe':return 'profiled_probe_js'
    if role=='../src/experimental/i80386.js':return 'authenticated_cpu_js'
    if role=='../src/experimental/i80386-native-dispatch.js':return 'authenticated_dispatch_js'
    if role in ('../src/experimental/i80386-at-machine.js',
                '../src/experimental/ata16.js','../src/at-8042-a20.js','../src/at-ps2-mouse.js'):
        return 'authenticated_board_device_js'
    if role is not None and role.endswith(('.js','.mjs')):return 'authenticated_other_js'
    if url.startswith('node:'):return 'node_runtime'
    return 'native_wasm_or_unresolved'
def summarize(path,source_root,inventory,generated_sha):
    mapping=source_roles(source_root,inventory,generated_sha)
    profile,by_id,total,negative,minimum,raw_sha=load(path)
    buckets={name:{'samples':0,'sampledDeltaMicroseconds':0} for name in (
      'profiled_probe_js','authenticated_cpu_js','authenticated_dispatch_js',
      'authenticated_board_device_js','authenticated_other_js','node_runtime',
      'v8_gc','native_wasm_or_unresolved')}
    for node_id,delta in zip(profile['samples'],profile['timeDeltas']):
        item=buckets[bucket(by_id[node_id]['callFrame'],mapping)]
        item['samples']+=1;item['sampledDeltaMicroseconds']+=delta
    for item in buckets.values():
        item['fractionOfSamples']=item['samples']/len(profile['samples'])
        if negative:
            item['sampledDeltaMicroseconds']=None;item['fractionOfSampledDeltas']=None
        else:item['fractionOfSampledDeltas']=item['sampledDeltaMicroseconds']/total
    return {'schema':'bw.xv6-js-sampling.v1','scope':'execution-loop V8 diagnostic samples; no precise CPU cost share or adoption timing',
      'rawProfileSha256':raw_sha,'nodeCount':len(by_id),'sampleCount':len(profile['samples']),
      'profileWindowMicroseconds':profile['endTime']-profile['startTime'],
      'timeDeltaStatus':'NONMONOTONIC_COUNTS_ONLY' if negative else 'MONOTONIC',
      'negativeTimeDeltaCount':negative,'minimumTimeDeltaMicroseconds':minimum,
      'rawSignedDeltaSumMicroseconds':total,'sampledDeltaMicroseconds':None if negative else total,
      'buckets':buckets,'limitations':[
        'Blank/WASM/native frames remain unresolved even when a JS ancestor is visible.',
        'Only exact canonical file URLs with matching source bytes receive source roles.',
        'Profiler start/stop and sampling perturb the measured execution; counts are diagnostic.',
        'Nonmonotonic sample timestamps suppress every delta-weighted bucket value.']}
