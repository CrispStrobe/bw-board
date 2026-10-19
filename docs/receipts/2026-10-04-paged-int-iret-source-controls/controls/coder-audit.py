import json,hashlib,subprocess,pathlib
P=pathlib.Path(__file__).parent;A=pathlib.Path('/tmp/native-paged-int-iret-source-auth-20261004');R=pathlib.Path('/tmp/bw-native-paged-int-iret-source-20261004')
read=lambda p:json.loads(p.read_text());capture=read(P/'js-control.json');before=read(P/'before.json');after=read(P/'after.json');assert before==after
for folder in [P,A]:
 e=read(folder/'exit.json');assert e['exitCode']==0 and not e['timeout'] and e['pinsEqual'];assert read(folder/'before.json')==read(folder/'after.json')
for name,pin in before['files'].items():
 b=(R/name).read_bytes();g=subprocess.check_output(['git','show',before['head']+':'+name],cwd=R);assert b==g and len(b)==pin['bytes'] and hashlib.sha256(b).hexdigest()==pin['sha256']
identity=read(A/'stdout');assert identity['revision']==before['head'];assert identity['hashes']=={p:x['sha256'] for p,x in before['files'].items()};assert len(identity['hashes'])==51
layout={'gdt':0,'directory':0x1000,'table':0x2000,'idt':0x3000,'aliasCode':0x7000,'aliasData':0x9000,'code':0xa000,'data':0xb000,'stack':0xc000,'aliasStack':0xd000}
frames=capture['frames'];assert len(frames)==42 and [x['q'] for x in frames]==list(range(42));checks=0
for f in frames+[capture['settled']]:
 pages={k:bytearray(4096) for k in layout};assert set(f['pages'])==set(layout)
 assert all(e['q']<=f['q'] for e in f['stores']+f['updates'])
 for e in f['stores']+[{'raw':e['raw'],'bytes':list(e['after'].to_bytes(4,'little'))} for e in f['updates']]:
  k=next(k for k,v in layout.items() if v==e['raw']&~4095);assert all(type(b)==int and 0<=b<=255 for b in e['bytes']);off=e['raw']&4095;pages[k][off:off+len(e['bytes'])]=bytes(e['bytes'])
 for k in pages:
  assert all(type(b)==int and 0<=b<=255 for b in f['pages'][k]);assert len(f['pages'][k])==4096 and bytes(f['pages'][k])==pages[k];checks+=4096
 c=f['cpu'];assert c['cr4']==0 and c['eflags']==2 and not c['halted'];assert f['board']['a20Enabled'] if 'a20Enabled' in f['board'] else True
expectedCuts=[('reset',0),('after-LGDT',25),('after-LIDT',26),('CR3-ready',28),('PE-enabled',30),('DS-ready',32),('SS-loaded',33),('SP-ready',34),('PG-enabled',36),('entered-paged-code',37),('before-INT',38),('entered-handler',39),('after-handler-MOV',40),('returned-from-IRET-before-HLT',41)]
assert [(x['name'],x['q']) for x in capture['cuts']]==expectedCuts
assert [frames[33]['cpu'][x] for x in ['interruptShadow','nmiShadow','debugShadow']]==[1,1,0];assert [frames[34]['cpu'][x] for x in ['interruptShadow','nmiShadow','debugShadow']]==[0,0,0]
for q,eax in [(37,0x80000001),(38,0x80001111),(39,0x80001111),(40,0x8000beef),(41,0x8000beef)]:assert frames[q]['cpu']['eax']==eax
end=frames[-1];assert len(end['stores'])==23 and len(end['updates'])==7 and len(end['deliveries'])==1
assert [(e['raw'],e['bytes'],e['q']) for e in end['stores'][-3:]]==[(0xcffa,[5,0x70],39),(0xcffc,[0x18,0],39),(0xcffe,[2,0],39)]
assert [(e['raw'],e['before'],e['after'],e['q']) for e in end['updates']]==[(0x1000,0x2003,0x2023,37),(0x23c0,0xf0003,0xf0023,37),(0x2000,3,0x23,37),(0x201c,0xa003,0xa023,38),(0x200c,0x3003,0x3023,39),(0x2034,0xc003,0xc023,39),(0x2034,0xc023,0xc063,39)]
assert end['pages']['idt'][0x180:0x188]==[0x10,0x70,24,0,0,0x86,0,0];assert end['pages']['stack'][0xffa:]==[5,0x70,24,0,2,0]
for q in [39,40]:assert frames[q]['cpu']['esp']==0xdffa
for key,value in {'eax':0x8000beef,'esp':0xe000,'cs':24,'eip':0x7005,'ss':16,'ds':16,'cr0':0xfffffff1,'cr3':0x1000,'cr4':0,'eflags':2}.items():assert end['cpu'][key]==value
settled=capture['settled'];assert settled['cpu']==end['cpu'] and settled['board']['debt']==0
reads=[e for e in settled['accesses'] if e['cs']==24 and e['eip']==0x7013 and 0xcffa<=e['raw']<0xd000];assert [(e['raw'],e['value']) for e in reads]==[(0xcffa,5),(0xcffb,0x70),(0xcffc,24),(0xcffd,0),(0xcffe,2),(0xcfff,0)]
for base in [0x7000,0x9000,0xd000]:assert not any(e['cs']==24 and base<=e['raw']<base+4096 for e in settled['accesses'])
result={'status':'PASS_CODER_PRIVATE_JS_INT_IRET_SOURCE_AUDIT','testedHead':before['head'],'sourceFiles':51,'controls':7,'instructions':41,'frames':42,'cuts':14,'pagesPerFrame':10,'wholePageBytesCheckedIncludingSettled':checks,'bootStores':20,'frameStores':3,'adUpdates':7,'ramSha256':settled['ramSha256'],'capture':{'bytes':(P/'js-control.json').stat().st_size,'sha256':hashlib.sha256((P/'js-control.json').read_bytes()).hexdigest()},'scope':'Actual private Bochs-model JS source only; no native build/admission/execution'}
(P/'coder-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
