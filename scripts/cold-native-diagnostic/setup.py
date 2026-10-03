"""Future hosted source-role setup, no artifact download or native execution."""
import sys
sys.dont_write_bytecode=True
import json
import os
from pathlib import Path
from parent import ROOT,W,D,U,bounded,validate_contract,git
from restore import checkout

def main():
    c=json.loads((ROOT/'scripts/cold-native-diagnostic/contract.json').read_text());validate_contract(c)
    out=Path(os.environ['BW_COLD_SETUP_OUTPUT']);assert out.is_absolute() and out.parent.resolve()==out.parent and out.parent.is_dir() and not os.path.lexists(out);out.mkdir()
    status={'status':'FAIL_SOURCE_SETUP_NO_NATIVE'}
    try:
        frozen=json.loads((ROOT/'scripts/cold-native-restore/frozen-members.json').read_text())
        for role,files,label,revision in [(W,frozen,'compiled',c['compiledRevision']),(D,c['driverFiles'],'driver',c['driverRevision'])]:
            assert git(role,'rev-parse','HEAD').decode().strip()==revision,'checkout HEAD before sparse'
            patterns=out/(label+'-sparse-patterns.txt');patterns.write_text(''.join('/'+n+'\n' for n in sorted(files)))
            # git sparse-checkout accepts stdin; source-owned patterns are supplied
            # through a short closed Python wrapper, never shell interpolation.
            code="import subprocess,sys; subprocess.run(['git','-C',sys.argv[1],'sparse-checkout','set','--no-cone','--stdin'],input=open(sys.argv[2]).read(),text=True,check=True,timeout=30)"
            r=bounded(['python3','-B','-c',code,str(role),str(patterns)],ROOT,out,label+'-sparse',cpu=30,wall=40)
            assert r['returncode']==0 and not r['timedOut']
            checkout(role,revision,files)
        assert not os.path.lexists(U),'existing pristine destination'
        commands=[['git','init',str(U)],['git','-C',str(U),'remote','add','origin','https://github.com/bochs-emu/Bochs.git'],['git','-C',str(U),'fetch','--depth=1','--no-tags','origin',c['bochsRevision']],['git','-C',str(U),'checkout','--detach','FETCH_HEAD']]
        for i,cmd in enumerate(commands):
            r=bounded(cmd,ROOT,out,'upstream-'+str(i),cpu=60,wall=90)
            assert r['returncode']==0 and not r['timedOut']
        status['status']='EXACT_SOURCE_ROLE_SETUP_PASS_NO_ARTIFACT_OR_NATIVE'
    except BaseException as error:status['error']=str(error);raise
    finally:(out/'final-status.json').write_text(json.dumps(status,indent=2)+'\n')
if __name__=='__main__':main()
