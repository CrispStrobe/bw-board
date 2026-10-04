"""Fixed owned diagnostic contract; PENDING precedes all effects."""
import hashlib,json
def require(ok,message):
 if not ok:raise ValueError(message)
AUTHORITY='df3ebbf0b864fd13e7a9b15288b8c72246638b9f072db7b46b3e604b45d81441'
def contract(c):
 require(c['status']=='ROOT_REVIEWED_NATIVE_SYMBOL_HOSTED_READY','PENDING before role emission/setup/tools/download/worker/recorder')
 require(hashlib.sha256(json.dumps({k:v for k,v in c.items() if k!='status'},sort_keys=True,separators=(',',':')).encode()).hexdigest()==AUTHORITY,'complete source-owned role/bounds authority')
 require(c['schema']=='bw.cold-ledger-scalars.native-symbol.hosted-source.v1' and c['enabledByDefault'] is False,'distinct default-disabled diagnostic')
 require(c['roles']['diagnostic']['status']=='ROOT_REVIEWED_NATIVE_SYMBOL_DIAGNOSTIC_READY','separate immutable diagnostic READY source prerequisite')
 return c
