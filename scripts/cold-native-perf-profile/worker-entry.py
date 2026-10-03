"""Resource/UID-only exec shim; accepted Node/worker CLI is unchanged."""
import sys,resource,os,json
from pathlib import Path
def exec_worker(args):
 if len(args)!=6 or args[3]!='--max-old-space-size=128':raise ValueError('one unchanged accepted worker CLI')
 uid,gid=map(int,args[:2])
 if uid<=0 or gid<0 or os.geteuid()!=0:raise ValueError('authenticated nonroot worker owner')
 resource.setrlimit(resource.RLIMIT_FSIZE,(16<<20,16<<20));resource.setrlimit(resource.RLIMIT_CPU,(60,60));resource.setrlimit(resource.RLIMIT_CORE,(0,0))
 os.setgroups([]);os.setgid(gid);os.setuid(uid)
 if os.getuid()!=uid or os.geteuid()!=uid or os.getgid()!=gid or os.getegid()!=gid or os.getgroups():raise ValueError('irreversible common-owner privilege drop')
 launch=Path(args[-1]).parent/'worker-output/launch.json'
 with launch.open('x') as f:json.dump({'uid':os.getuid(),'euid':os.geteuid(),'gid':os.getgid(),'egid':os.getegid(),'supplementaryGroups':os.getgroups(),'command':args[2:]},f)
 os.execv(args[2],args[2:])
if __name__=='__main__':exec_worker(sys.argv[1:])
