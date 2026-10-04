"""Closed hosted diagnostic source authority; no caller-derived readiness."""
import json,hashlib
from pathlib import Path
def require(condition,message):
 if not condition:raise ValueError(message)
HERE=Path(__file__).resolve().parent
def contract(value):
 require(value['status']=='ROOT_REVIEWED_EXECUTION_PROFILE_HOSTED_READY','pending refuses before checkout/download/spawn')
 require(hashlib.sha256(json.dumps({k:v for k,v in value.items() if k!='status'},sort_keys=True,separators=(',',':')).encode()).hexdigest()=='8d047a4f3c731e894f5eceae98fc55317432cc252684e8800873524043a7a24c','full source-owned authority')
 require(value['enableProfileByDefault'] is False and value['scope']=='DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION','diagnostic only')
 require(value['diagnosticWorker']['authorityStatus']=='ROOT_REVIEWED_EXECUTION_PROFILE_READY','worker authority remains pending')
 require(value['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10},'held child bounds')
 require(value['setupBounds']=={**value['bounds'],'fileBytes':32<<20},'setup archive allowance only')
 return value
