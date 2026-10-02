import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installPackedScalar,scalarU32} from '../scripts/bochs-cpu3-native-hot-packed-scalar/packed-scalar.mjs';
import {derivePackedScalarNapi,originalNapiSha256} from '../scripts/bochs-cpu3-native-hot-packed-scalar/napi.mjs';
function make(){const events=[];const board={nativeTick(){events.push(['tick',this===board,...arguments]);return 0;},quantum(){events.push(['q',this===board,...arguments]);return 1;},outPort(){events.push(['pio',this===board,...arguments]);return{value:7,mappingEpoch:2,boardA20:0};},acknowledgeIrq(){events.push(['ack',this===board,...arguments]);return 32;},mappingState(){events.push(['map',this===board,...arguments]);return{mappingEpoch:2,boardA20:1};}};installPackedScalar(board);return{board,events};}
test('all four operations retain exact original receiver, argc and metadata source',()=>{
 const{board,events}=make();assert.deepEqual([...board.packedScalar(1,9,8,7)],[0,2,1]);assert.deepEqual([...board.packedScalar(2,9,8,7)],[1,2,1]);assert.deepEqual([...board.packedScalar(3,9,8,7)],[7,2,0]);assert.deepEqual([...board.packedScalar(4,9,8,7)],[32,2,1]);
 assert.deepEqual(events,[['tick',true],['map',true],['q',true,9],['map',true],['pio',true,9,8,7],['ack',true],['map',true]]);
});
test('tuple is reused but not mutated until every validation succeeds',()=>{
 const{board}=make(),tuple=board.packedScalar(1,0,0,0);assert.equal(tuple.byteOffset,0);assert.equal(tuple.buffer.byteLength,12);
 board.mappingState=()=>({mappingEpoch:99,boardA20:NaN});assert.throws(()=>board.packedScalar(2,0,0,0),/finite integer/);assert.deepEqual([...tuple],[0,2,1]);
 board.mappingState=()=>({mappingEpoch:3,boardA20:0});assert.equal(board.packedScalar(4,0,0,0),tuple);assert.deepEqual([...tuple],[32,3,0]);
});
test('method getter may replace the subsequent mapping and tick methods dynamically',()=>{
 const{board}=make(),order=[];Object.defineProperty(board,'quantum',{get(){order.push('q getter');board.mappingState=()=>{order.push('new map');return{mappingEpoch:4,boardA20:0};};board.nativeTick=()=>{order.push('new tick');return 0;};return function(kind){assert.equal(this,board);assert.equal(kind,1);order.push('q call');return 0;};}});
 assert.deepEqual([...board.packedScalar(2,1,0,0)],[0,4,0]);board.packedScalar(1,0,0,0);assert.deepEqual(order,['q getter','q call','new map','new tick','new map']);
});
test('PIO value validates before epoch, epoch getter can replace later A20 getter',()=>{
 const{board}=make(),order=[];board.outPort=()=>({get value(){order.push('value');return 8;},get mappingEpoch(){order.push('epoch');Object.defineProperty(this,'boardA20',{get(){order.push('new A20');return 1;},configurable:true});return 4;},get boardA20(){throw Error('old A20');}});
 assert.deepEqual([...board.packedScalar(3,0,0,0)],[8,4,1]);assert.deepEqual(order,['value','epoch','new A20']);
});
for(const bad of [NaN,Infinity,-1,0.5,4294967296,'1',1n,null,undefined])test('invalid operation value denies mapping lookup: '+String(bad),()=>{
 const{board}=make();let calls=0;board.quantum=()=>bad;Object.defineProperty(board,'mappingState',{get(){calls++;throw Error('must not read mapping');}});assert.throws(()=>board.packedScalar(2,0,0,0),/finite integer/);assert.equal(calls,0);
});
test('invalid epoch denies later A20 getter and preserves tuple',()=>{
 const{board}=make(),tuple=board.packedScalar(1,0,0,0);let later=0;board.mappingState=()=>({get mappingEpoch(){return -1;},get boardA20(){later++;return 0;}});assert.throws(()=>board.packedScalar(1,0,0,0),/finite integer/);assert.equal(later,0);assert.deepEqual([...tuple],[0,2,1]);
});
test('throwing getters preserve exception and clear wrapper reentry state',()=>{
 const{board}=make(),error=Error('hostile');board.mappingState=()=>({get mappingEpoch(){throw error;},get boardA20(){assert.fail('later getter');}});assert.throws(()=>board.packedScalar(1,0,0,0),e=>e===error);board.mappingState=()=>({mappingEpoch:0,boardA20:1});assert.deepEqual([...board.packedScalar(1,0,0,0)],[0,0,1]);
});
test('direct wrapper reentry rejects before a second host operation or tuple mutation',()=>{
 const{board,events}=make();board.mappingState=function(){assert.throws(()=>this.packedScalar(3,1,2,3),/reentry/);return{mappingEpoch:0,boardA20:1};};assert.deepEqual([...board.packedScalar(1,0,0,0)],[0,0,1]);assert.deepEqual(events,[['tick',true]]);
});
test('wrong receiver or opcode denies all host effects',()=>{
 const{board,events}=make();assert.throws(()=>board.packedScalar.call({},1,0,0,0),/receiver/);for(const op of [0,5,1.5,'1'])assert.throws(()=>board.packedScalar(op,0,0,0),/operation/);assert.deepEqual(events,[]);
});
test('installation does not read methods and denies inherited collision without getter execution',()=>{
 let read=0;const board={get quantum(){read++;return()=>0;}};installPackedScalar(board);assert.equal(read,0);assert.deepEqual(Object.getOwnPropertyDescriptor(board,'packedScalar'),{value:board.packedScalar,writable:false,enumerable:false,configurable:false});
 const collision=Object.create({get packedScalar(){read++;throw Error('collision getter');}});assert.throws(()=>installPackedScalar(collision),/collision/);assert.equal(read,0);
});
test('negative zero and maximum u32 retain original C numeric domain',()=>{assert.ok(Object.is(scalarU32(-0),-0));assert.equal(scalarU32(0xffffffff),0xffffffff);});
test('generated native delta replaces only scalar and retains all original ownership/lifecycle bytes',()=>{
 const base=readFileSync(new URL('../scripts/bochs-cpu3-native-direct-board-adapter/napi.cc',import.meta.url));assert.equal(createHash('sha256').update(base).digest('hex'),originalNapiSha256);const b=base.toString(),g=derivePackedScalarNapi().toString();
 const begin=g.indexOf('int scalar('),end=g.indexOf('\nbw_direct_callbacks callbacks=',begin),bs=b.indexOf('int scalar('),be=b.indexOf('\nbw_direct_callbacks callbacks=',bs);
 assert.equal(g.slice(0,begin),'/* H4 owned packed scalar protocol; unprofiled ABI2 exports unchanged. */\n'+b.slice(0,bs));assert.equal(g.slice(end),b.slice(be));
 const body=g.slice(begin,end);assert.match(body,/type==napi_uint32_array&&length==3&&offset==0/);assert.match(body,/napi_is_arraybuffer.*ordinary.*napi_is_detached_arraybuffer.*!detached/);assert.match(body,/backing==data&&backing_length==12/);assert.match(body,/memcpy\(copied_words,data,sizeof copied_words\);\*value=copied_words\[0\];\*epoch=copied_words\[1\];\*a20=copied_words\[2\]/);assert.ok(body.indexOf('memcpy(copied_words')<body.indexOf('napi_close_handle_scope'));assert.equal(g.includes('BWNP1'),false);
});

test('host methods cannot replace validation or lookup intrinsics mid-callback',()=>{
 const{board}=make(),saved={integer:Number.isInteger,finite:Number.isFinite,get:Reflect.get,apply:Reflect.apply};let later=0,error;
 board.quantum=()=>{Number.isInteger=()=>true;Number.isFinite=()=>true;Reflect.get=()=>0;Reflect.apply=()=>0;return 1;};
 board.mappingState=()=>({mappingEpoch:0.5,get boardA20(){later++;return 1;}});
 try{board.packedScalar(2,0,0,0);}catch(e){error=e;}finally{Number.isInteger=saved.integer;Number.isFinite=saved.finite;Reflect.get=saved.get;Reflect.apply=saved.apply;}
 assert.match(error?.message??'',/finite integer/);assert.equal(later,0);
});
test('captured tuple and error constructors cannot be replaced after module initialization',()=>{
 const Tuple=globalThis.Uint32Array,Failure=globalThis.TypeError;let tuple,error;
 try{globalThis.Uint32Array=function(){throw Error('mutable tuple ctor');};globalThis.TypeError=function(){throw Error('mutable error ctor');};const board={nativeTick:()=>0,mappingState:()=>({mappingEpoch:0,boardA20:1})};installPackedScalar(board);tuple=board.packedScalar(1,0,0,0);board.nativeTick=()=>0.5;try{board.packedScalar(1,0,0,0);}catch(e){error=e;}}
 finally{globalThis.Uint32Array=Tuple;globalThis.TypeError=Failure;}
 assert.ok(tuple instanceof Tuple);assert.ok(error instanceof Failure);assert.match(error.message,/finite integer/);
});
test('primitive mapping state is freshly boxed per original NAPI property read',()=>{
 const oldEpoch=Object.getOwnPropertyDescriptor(Number.prototype,'mappingEpoch'),oldA20=Object.getOwnPropertyDescriptor(Number.prototype,'boardA20'),objects=[],events=[];const{board}=make();let tuple;
 try{Object.defineProperty(Number.prototype,'mappingEpoch',{configurable:true,get(){objects.push(this);events.push(['epoch',this.valueOf()]);return 9;}});Object.defineProperty(Number.prototype,'boardA20',{configurable:true,get(){objects.push(this);events.push(['a20',this.valueOf()]);return 1;}});board.mappingState=()=>17;tuple=[...board.packedScalar(1,0,0,0)];}
 finally{if(oldEpoch)Object.defineProperty(Number.prototype,'mappingEpoch',oldEpoch);else delete Number.prototype.mappingEpoch;if(oldA20)Object.defineProperty(Number.prototype,'boardA20',oldA20);else delete Number.prototype.boardA20;}
 assert.deepEqual(tuple,[0,9,1]);assert.deepEqual(events,[['epoch',17],['a20',17]]);assert.ok(objects[0] instanceof Number);assert.ok(objects[1] instanceof Number);assert.notEqual(objects[0],objects[1]);
});
test('primitive PIO response preserves value then epoch then A20 boxing and getter mutation',()=>{
 const names=['value','mappingEpoch','boardA20'],saved=names.map(k=>Object.getOwnPropertyDescriptor(Number.prototype,k)),objects=[],events=[];const{board}=make();let tuple;
 try{Object.defineProperty(Number.prototype,'value',{configurable:true,get(){objects.push(this);events.push(['value',this.valueOf()]);return 23;}});Object.defineProperty(Number.prototype,'mappingEpoch',{configurable:true,get(){objects.push(this);events.push(['epoch',this.valueOf()]);Object.defineProperty(Number.prototype,'boardA20',{configurable:true,get(){objects.push(this);events.push(['new a20',this.valueOf()]);return 0;}});return 4;}});Object.defineProperty(Number.prototype,'boardA20',{configurable:true,get(){throw Error('stale A20');}});board.outPort=()=>18;tuple=[...board.packedScalar(3,0,0,0)];}
 finally{names.forEach((k,i)=>{if(saved[i])Object.defineProperty(Number.prototype,k,saved[i]);else delete Number.prototype[k];});}
 assert.deepEqual(tuple,[23,4,0]);assert.deepEqual(events,[['value',18],['epoch',18],['new a20',18]]);assert.equal(new Set(objects).size,3);assert.ok(objects.every(o=>o instanceof Number));
});
test('primitive invalid fields short-circuit before later prototype getters',()=>{
 const names=['value','mappingEpoch','boardA20'],saved=names.map(k=>Object.getOwnPropertyDescriptor(Number.prototype,k)),events=[];const{board}=make();
 try{Object.defineProperty(Number.prototype,'value',{configurable:true,get(){events.push('value');return NaN;}});Object.defineProperty(Number.prototype,'mappingEpoch',{configurable:true,get(){events.push('epoch');return 0.5;}});Object.defineProperty(Number.prototype,'boardA20',{configurable:true,get(){events.push('a20');return 1;}});board.outPort=()=>1;assert.throws(()=>board.packedScalar(3,0,0,0),/finite integer/);assert.deepEqual(events,['value']);events.length=0;board.mappingState=()=>1;assert.throws(()=>board.packedScalar(1,0,0,0),/finite integer/);assert.deepEqual(events,['epoch']);}
 finally{names.forEach((k,i)=>{if(saved[i])Object.defineProperty(Number.prototype,k,saved[i]);else delete Number.prototype[k];});}
});
test('primitive boxing uses captured Object even when an operation replaces global Object',()=>{
 const ObjectIntrinsic=Object,names=['mappingEpoch','boardA20'],saved=names.map(k=>Object.getOwnPropertyDescriptor(Number.prototype,k));const{board}=make();let tuple;
 try{ObjectIntrinsic.defineProperty(Number.prototype,'mappingEpoch',{configurable:true,get(){return 0;}});ObjectIntrinsic.defineProperty(Number.prototype,'boardA20',{configurable:true,get(){return 1;}});board.quantum=()=>{globalThis.Object=()=>{throw Error('mutable Object');};return 0;};board.mappingState=()=>1;tuple=[...board.packedScalar(2,0,0,0)];}
 finally{globalThis.Object=ObjectIntrinsic;names.forEach((k,i)=>{if(saved[i])ObjectIntrinsic.defineProperty(Number.prototype,k,saved[i]);else delete Number.prototype[k];});}
 assert.deepEqual(tuple,[0,0,1]);
});
