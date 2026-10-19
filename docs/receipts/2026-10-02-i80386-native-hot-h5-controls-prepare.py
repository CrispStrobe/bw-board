import pathlib,json,hashlib,re,subprocess,sys
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-args-20261001');sha=lambda b:hashlib.sha256(b).hexdigest();old=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-runtime-controls-20261001/child.mjs');text=old.read_text();original=text;assert sha(old.read_bytes())=='ad5a371fc2a8fad45f1c1850b610bf5d1de012177c88be1508010325bac8de75'
text=text.replace('/tmp/bw-board-386-native-hot-packed-scalar-20261001',str(W))
# Use exact H5 driver's identity implementation rather than silently inheriting H4 seeds.
driver=W/'scripts/run-i80386-native-hot-packed-args.mjs';d=driver.read_text();assert driver.read_bytes()==subprocess.check_output(['git','show','HEAD:scripts/run-i80386-native-hot-packed-args.mjs'],cwd=W);identity=re.search(r'function identity\(\).*?\n',d).group();text=re.sub(r'function identity\(\).*?\n',lambda _:identity,text,count=1)
text="import {installPackedScalar} from 'file://"+str(W/'scripts/bochs-cpu3-native-hot-packed-scalar/packed-scalar.mjs')+"';\n"+text
text=text.replace("input.control?.startsWith('tuple-')?loadHotNative:loadPackedHotNative", "(input.control?.startsWith('tuple-')||input.control==='packed-argc')?loadHotNative:loadPackedHotNative")
needle="if(control==='method-swap'){"
extra="""if(control==='packed-argc'){
 const forwarding={},seen=new Set();
 for(const [name,argc] of [['nativeTick',0],['quantum',1],['outPort',3],['acknowledgeIrq',0],['mappingState',0]]){const original=board[name];board[name]=function(...args){assert.equal(this,board);assert.equal(args.length,argc);return Reflect.apply(original,board,args);};}
 for(const [name,argc] of [['nativeTick',0],['quantum',1],['outPort',3],['acknowledgeIrq',0],['mappingState',0]])forwarding[name]=function(...args){assert.equal(this,forwarding);assert.equal(args.length,argc);return Reflect.apply(board[name],board,args);};
 installPackedScalar(forwarding);
 board.packedScalar=function(...args){assert.equal(this,board);const op=args[0],expected=op===2?2:op===3?4:1;assert.equal(args.length,expected);if(!seen.has(op)){seen.add(op);event('packed-argc',{op,argc:args.length});}attacked=true;return Reflect.apply(forwarding.packedScalar,forwarding,args);};
}else if(control==='method-swap'){
"""
assert text.count(needle)==1;text=text.replace(needle,extra)
(P/'child.mjs').write_text(text)
(P/'preparation.json').write_text(json.dumps({'status':'SOURCE_ONLY_NOT_EXECUTED','originalH4ControlChildSha256':sha(old.read_bytes()),'heldH5DriverSha256':sha(driver.read_bytes()),'childSha256':sha(text.encode()),'changes':['absolute import roots','H5 original identity function','unchanged H4 source wrapper import','raw loader for new packed-argc control','one new internal argc control'],'pending':'Freeze and bind exact H5 revision/build/compiled manifest before execution'},indent=2))
print(sha(text.encode()))
