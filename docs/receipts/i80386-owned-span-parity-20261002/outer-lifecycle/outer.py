import subprocess,sys,time,pathlib
p=subprocess.Popen([sys.executable,'/mnt/volume1/tmp-astra/386-owned-span-hosted-outer-lifecycle-control-20261002/grand.py'],start_new_session=True)
pathlib.Path('/mnt/volume1/tmp-astra/386-owned-span-hosted-outer-lifecycle-control-20261002/grand.pid').write_text(str(p.pid))
time.sleep(20)
