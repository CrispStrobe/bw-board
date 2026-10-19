import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePackedArgsNapi,argumentDeclaration,h4GeneratedNapiSha256} from '../scripts/bochs-cpu3-native-hot-packed-args/napi.mjs';
import {derivePackedScalarNapi} from '../scripts/bochs-cpu3-native-hot-packed-scalar/napi.mjs';
import {installPackedScalar} from '../scripts/bochs-cpu3-native-hot-packed-scalar/packed-scalar.mjs';
import {createHash} from 'node:crypto';
const old=derivePackedScalarNapi().toString(),candidate=derivePackedArgsNapi().toString();
test('authenticated H4 is restored by reversing only declaration and argc changes',()=>{
 assert.equal(createHash('sha256').update(old).digest('hex'),h4GeneratedNapiSha256);
 const header='/* H5 conditional scalar arguments only; H4 host protocol unchanged. */\n';assert.ok(candidate.startsWith(header));let inverse=candidate.slice(header.length);
 assert.equal(inverse.split(argumentDeclaration).length,2);inverse=inverse.replace(argumentDeclaration,'napi_value args[4]={number(op),number(a),number(b),number(c)},r,ab;');assert.equal(inverse.split('call("packedScalar",argc,args,&r)').length,2);inverse=inverse.replace('call("packedScalar",argc,args,&r)','call("packedScalar",4,args,&r)');assert.equal(inverse,old);
});
test('numeric handles are conditional and unsupported op guard still precedes dynamic callback',()=>{
 assert.equal(argumentDeclaration,'napi_value args[4]={number(op),nullptr,nullptr,nullptr},r,ab;size_t argc=1;\n if(op==2){args[1]=number(a);argc=2;}else if(op==3){args[1]=number(a);args[2]=number(b);args[3]=number(c);argc=4;}');
 assert.match(candidate,/bool success=op>=1&&op<=4&&call\("packedScalar",argc,args,&r\)/);
});
function boardFactory(){const events=[];const board={nativeTick(){events.push(['tick',this===board,...arguments]);return 0;},quantum(kind){events.push(['q',this===board,...arguments]);return kind;},outPort(port,width,value){events.push(['out',this===board,...arguments]);return{value:0,mappingEpoch:1,boardA20:0};},acknowledgeIrq(){events.push(['ack',this===board,...arguments]);return 32;},mappingState(){events.push(['map',this===board,...arguments]);return{mappingEpoch:0,boardA20:1};}};installPackedScalar(board);return{board,events};}
for(const [label,internal,args,expected] of [
 ['tick',[1],[],[0,0,1]],['ordinary quantum',[2,0],[0],[0,0,1]],['REP quantum',[2,1],[1],[1,0,1]],['PIO',[3,0x60,1,3],[0x60,1,3],[0,1,0]],['ACK',[4],[],[32,0,1]]
])test('unchanged wrapper preserves '+label+' effects with omitted unused packed parameters',()=>{
 const full=boardFactory(),short=boardFactory(),oldArgs=[internal[0],internal[1]??123,internal[2]??456,internal[3]??789];
 assert.deepEqual([...Reflect.apply(short.board.packedScalar,short.board,internal)],expected);assert.deepEqual([...Reflect.apply(full.board.packedScalar,full.board,oldArgs)],expected);assert.deepEqual(short.events,full.events);assert.deepEqual(short.events[0].slice(2),args);
});
test('omitted tick parameters cannot hide invalid metadata or wrapper reentry',()=>{
 const{board,events}=boardFactory();let later=0;board.mappingState=function(){assert.throws(()=>this.packedScalar(4),/reentry/);return{mappingEpoch:0.5,get boardA20(){later++;return 1;}};};assert.throws(()=>board.packedScalar(1),/finite integer/);assert.deepEqual(events,[['tick',true]]);assert.equal(later,0);
});
