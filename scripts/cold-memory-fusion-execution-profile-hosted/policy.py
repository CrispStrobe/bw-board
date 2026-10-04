"""Closed hosted diagnostic source authority; no caller-derived readiness."""
import json,hashlib
from pathlib import Path
def require(condition,message):
 if not condition:raise ValueError(message)
HERE=Path(__file__).resolve().parent
def contract(value):
 require(value['status']=='ROOT_REVIEWED_EXECUTION_PROFILE_HOSTED_READY','pending refuses before checkout/download/spawn')
 require(hashlib.sha256(json.dumps({k:v for k,v in value.items() if k!='status'},sort_keys=True,separators=(',',':')).encode()).hexdigest()=='babf3b2f113fe8175b2b3c55343fdd6d6aa8559001735e2f94c26c1b1b63f852','full source-owned authority')
 require(value['enableProfileByDefault'] is False and value['scope']=='DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION','diagnostic only')
 require(value['diagnosticWorker']['authorityStatus']=='ROOT_REVIEWED_EXECUTION_PROFILE_READY','worker authority remains pending')
 require(value['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10},'held child bounds')
 require(value['setupBounds']=={**value['bounds'],'fileBytes':32<<20},'setup archive allowance only')
 return value
