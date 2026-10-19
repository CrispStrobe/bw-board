import pathlib,json,hashlib,subprocess,collections
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-owned-pic-imr-source-20261002');c=json.loads((P/'guest/capture.json').read_bytes());n=0;H=lambda b:hashlib.sha256(b).hexdigest()
def ck(x):
 global n
 assert x;n+=1
ck(json.loads((P/'auth-before.json').read_bytes())==json.loads((P/'auth-after.json').read_bytes()));e=json.loads((P/'exit.json').read_bytes());ck(e['returncode']==0 and not e['timeout']);ck(len(c['source']['hashes'])==111)
for f,h in c['source']['hashes'].items():ck(H((W/f).read_bytes())==h);ck(H(subprocess.check_output(['git','show',c['source']['revision']+':'+f],cwd=W))==h)
b=(P/'guest/events.jsonl').read_bytes();ck(H(b)==c['journal']['sha256']);ck(len(b)==c['journal']['bytes']);rows=[json.loads(x)for x in b.splitlines()];ck(len(rows)==117487);steps=[x for x in rows if x[0]=='STEP'];ck(len(steps)==c['attempts']==100702);q=0
for i,x in enumerate(steps,1):ck(x[1]==i);ck(x[2]-q in (0,1));q=x[2];ck(x[9]==4+6*q)
ck(q==c['q']==100700);ck(c['halted']);ck([x[1:]for x in rows if x[0]=='PIO']==[[y[k]for k in ['q','attempts','cycles','dir','port','value']]for y in c['ports']]);ck(len(c['ports'])==35);ck([(x['port'],x['value'])for x in c['ports']if x['dir']=='in']==[(64,50),(64,18),(33,255),(161,255)])
ck(c['final']['in8Witness']==[50,18]);ck(c['final']['picImrWitness']==[255,255]);ck([(x['port'],x['reg'],x['value'])for x in c['picReads']]==[(33,1,255),(161,1,255)])
for x in c['picReads']:ck(x['before']==x['after']);ck(x['before']['imr']==255 and x['before']['pollPending']is False);ck(x['before']['irr']==x['before']['isr']==0 and not x['before']['intActive'])
ck([x['q']for x in c['boundaries'].values()]==[195,201,80201,80205,100685,100699])
for x in c['boundaries'].values():ck(x['cpu']['cycles']==x['q']);ck(x['board']['cycles']==4+6*x['q'])
ck([x[1:]for x in rows if x[0]=='DELIVERY']==[[x['kind'],x['vector'],x['q'],x['attempts'],x['cpu']['eip'],x['cpu']['esp']]for x in c['deliveries']]);ck([(x['kind'],x['vector'])for x in c['deliveries']]==[('fault',14),('fault',14),('irq',32)])
ck(c['final']['board']['debt']==0);ck(c['final']['board']['cycles']==4+6*q)
r={'status':'PASS_ACTUAL_JS_PIC_IMR_REFERENCE_NOT_NATIVE_QUALIFICATION','checks':n,'sourceRevision':c['source']['revision'],'sourceInputs':111,'captureSha256':H((P/'guest/capture.json').read_bytes()),'journalRows':117487,'attempts':100702,'successfulQuanta':100700,'ports':35,'scope':'Authenticatesactualsource/journalledgers/allPIO/deliveries/cuts/fullPICbeforeafterreadstate. PIT50/18 PICff/ff noIRR/ISR/ACKeffect inread. JSonly; no independentemulationofunexportedstate/native/performancequalification.'};(P/'independent-js-reference-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
