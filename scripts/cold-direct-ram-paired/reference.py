"""Authenticate one official qualified ZIP and distill exact semantic cuts.

This performs an independent initial-RAM/journal replay before any timed child.
"""
import base64,hashlib,json,sys,zipfile
from pathlib import Path
from policy import CONTRACT,require

def digest(data):return hashlib.sha256(data).hexdigest()
def authenticate(zip_path,output):
    role=CONTRACT['actualQualification'];raw=Path(zip_path).read_bytes()
    require(len(raw)==role['zipBytes'] and digest(raw)==role['zipSha256'],'qualified official ZIP identity')
    with zipfile.ZipFile(zip_path) as archive:
        names=archive.namelist()
        require(len(names)==40 and len(set(names))==40 and all('/' not in n and '\\' not in n and n not in ('.','..') for n in names),'flat unique artifact members')
        inventory=json.loads(archive.read('artifact-inventory.json'))['files']
        require(set(inventory)-set(names)=={'direct-mock','direct.node','owned_ram.node'},'declared omitted binaries only')
        require(set(names)==set(inventory)-{'direct-mock','direct.node','owned_ram.node'}|{'artifact-inventory.json'},'exact member inventory')
        for name in names:
            data=archive.read(name)
            require(len(data)<=48<<20,'bounded member')
            if name!='artifact-inventory.json':
                require(len(data)==inventory[name]['bytes'] and digest(data)==inventory[name]['sha256'],'member digest '+name)
        d={mode:json.loads(archive.read(mode+'.json')) for mode in ('direct','owned','callback')}
        build=json.loads(archive.read('build-auth.json'))
        require(archive.read('source-head.txt').decode().strip()==CONTRACT['qualifiedSourceHead'],'source head')
        require(build['sourceHead']==CONTRACT['qualifiedSourceHead'] and
                build['addonSha256']==role['directAddonSha256'],'qualified build source/addon')
        require(d['direct']['admission']['sourceHead']==CONTRACT['qualifiedSourceHead'] and
                d['direct']['admission']['addonSha256']==role['directAddonSha256'] and
                d['direct']['admission']['buildAuthSha256']==digest(archive.read('build-auth.json')),'direct admission')
        require(d['direct']['admission']['biosSha256']==CONTRACT['biosSha256'],'free ROM bytes')
    reference=d['callback'];direct=d['direct']
    for mode,x in d.items():
        require(x['target']==role['targetQuanta'] and x['resumes']==role['resumes'] and x['zero']==0,'workload '+mode)
        require(x['ports']==reference['ports'] and len(x['ports'])==role['orderedPorts'],'ordered PIO '+mode)
        require(x['board']==reference['board'] and x['ramSha256']==reference['ramSha256']==role['ramSha256'],'board/RAM '+mode)
        require(x['lastReturn']==reference['lastReturn'],'compact last return '+mode)
        for cut in ('reset','last','final'):
            n=x['reset']['native'] if cut=='reset' else x[cut]
            baseline=reference['reset']['native'] if cut=='reset' else reference[cut]
            fields=('state','extra','segments','system','debug','nativeTicks','successfulQuanta',
                    'mappingEpoch','boardA20','clockTransfers','callbacks','fallback','execution')
            require([len(n[k]) for k in fields[:5]]==[20,20,90,30,6],'all166 '+mode+cut)
            require(all(n[k]==baseline[k] for k in fields),'native semantic '+mode+cut)
            require(all(int(v)==0 for v in n['fallback'].values()),'no fallback '+mode+cut)
        require(x['reset']['board']==reference['reset']['board'],'reset board '+mode)
    require(len(direct['journal'])==91958,'qualified ordered journal extent')
    ram=bytearray(base64.b64decode(direct['initialRamBase64'],validate=True))
    require(len(ram)==0x1000000 and digest(ram)==direct['initialRamSha256'],'qualified initial 16MiB')
    generations={};effect=previous_n=previous_q=0;session=None
    for sequence,e in enumerate(direct['journal'],1):
        if session is None:session=e['sessionIdentity']
        require(e['sessionIdentity']==session and e['sequence']==sequence and e['effect']>effect,'journal identity/sequence/effect')
        require(previous_q<=e['q']<=e['n']<=role['targetQuanta'] and e['n']>=previous_n and e['epoch']==0,'journal N/Q/epoch')
        effect=e['effect'];previous_n=e['n'];previous_q=e['q']
        address=e['address'];before=bytes(e['before']);after=bytes(e['after']);page=address&~4095
        require(0<=address<0x180000 and 1<=len(before)==len(after)<=16 and
                address+len(after)<=0x180000 and (address&4095)+len(after)<=4096,'journal span')
        require(ram[address:address+len(before)]==before,'exact before byte')
        require(e['generation']==generations.get(page,0)+1,'page generation')
        generations[page]=e['generation'];ram[address:address+len(after)]=after
    require(effect==91958 and digest(ram)==role['ramSha256'],'exactly-once final RAM')
    require([list(pair) for pair in generations.items()]==direct['generationEntries']==direct['board']['generations'],'first-touch order')
    before=direct['direct']['beforeClose'];after=direct['direct']['afterClose']
    require(before['committed']==before['acknowledged']==after['committed']==after['acknowledged']=='91958','contiguous owner ACK')
    require(before['directReads']=='91949' and before['directWrites']=='91958','source direct effects')
    require(all(before[k] is False and after[k] is False for k in ('ownerFailed','prepared','pageTicket','uncommittedRetry','committedCodeFence')),'no pending/fence')
    require(after['ownerClosed'] and after['cpuClosed'] and all(direct['direct']['closure'].values()),'four closures')
    compact={k:direct[k] for k in ('target','resumes','zero','reset','lastReturn','last','final','board','ramSha256','ports')}
    compact.update(schema='bw.cold-direct-ram.paired-reference.v1',sourceHead=CONTRACT['qualifiedSourceHead'],
                   officialZipSha256=role['zipSha256'],journalEntries=len(direct['journal']),
                   initialRamSha256=direct['initialRamSha256'],directOwner=direct['direct'])
    data=(json.dumps(compact,separators=(',',':'))+'\n').encode()
    require(len(data)<=4<<20,'bounded child reference')
    Path(output).open('xb').write(data)
    return {'referenceSha256':digest(data),'bytes':len(data),'qualifiedSourceHead':CONTRACT['qualifiedSourceHead'],
            'journalEntries':len(direct['journal']),'ports':len(direct['ports']),'parity':'PASS'}

if __name__=='__main__':
    require(len(sys.argv)==3,'official ZIP and exclusive reference output')
    print(json.dumps(authenticate(sys.argv[1],sys.argv[2]),sort_keys=True))
