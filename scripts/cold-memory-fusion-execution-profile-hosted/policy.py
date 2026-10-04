"""Closed hosted diagnostic source authority; no caller-derived readiness."""
import json,hashlib
from pathlib import Path
def require(condition,message):
 if not condition:raise ValueError(message)
HERE=Path(__file__).resolve().parent
def contract(value):
 require(value['status']=='ROOT_REVIEWED_EXECUTION_PROFILE_HOSTED_READY','pending refuses before checkout/download/spawn')
 require(hashlib.sha256(json.dumps({k:v for k,v in value.items() if k!='status'},sort_keys=True,separators=(',',':')).encode()).hexdigest()=='7e3a7584628c85ffdd8de7c5d4b262539995d71c141a5508c75f875b5b8573f9','full source-owned authority')
 require(value['enableProfileByDefault'] is False and value['scope']=='DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION','diagnostic only')
 require(value['diagnosticWorker']['authorityStatus']=='ROOT_REVIEWED_EXECUTION_PROFILE_READY','worker authority remains pending')
 require(value['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10},'held child bounds')
 require(value['setupBounds']=={**value['bounds'],'fileBytes':32<<20},'setup archive allowance only')
 return value

def diagnostic_worker_role(c):
 w=c['diagnosticWorker']
 require(w['binding']=='scripts/cold-native-memory-fusion-execution-profile/capture-binding.json' and w['binding'] in w['files'],'fixed diagnostic lock belongs to authenticated role')
 require(w['root']=='/home/runner/work/bw-board/bw-board/diagnostic-worker','fixed distinct diagnostic root')
 require(w['entry']=='scripts/cold-native-memory-fusion-execution-profile/worker.mjs','fixed diagnostic entry')
 return {**w,'files':{p:r['sha256'] for p,r in w['files'].items()}}
def terminal_projection(r):
 require(r['schema']=='bw.cold-native-memory-fusion.execution-profile.worker.v1' and r['status']=='EXECUTION_WINDOW_DIAGNOSTIC_PARITY_AND_PROFILE_CAPTURE_PASS','diagnostic outcome')
 require(r['terminalParityStatus']=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS','terminal proof independent of profile')
 return {**r,'schema':'bw.cold-native-memory-fusion-performance.worker.v1','status':r['terminalParityStatus']}
