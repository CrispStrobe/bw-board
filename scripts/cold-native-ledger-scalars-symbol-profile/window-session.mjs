/** Owned recorder protocol only; no machine, addon or execution in this module. */
import assert from 'node:assert/strict';
import {createConnection} from 'node:net';
import {lstatSync,realpathSync} from 'node:fs';
export const socketPath='/home/runner/work/_temp/cold-ledger-scalars-native-symbol/control.sock';
export const perfImageSha256='5fb08c90293471b24086be829f4da4707ecc83101945868101964be48267ab71';
const schema='bw.cold-ledger-scalars.native-symbol.control.v1';
const decimal=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(x);
function transport(){
 const parent=socketPath.slice(0,socketPath.lastIndexOf('/')),directory=lstatSync(parent),entry=lstatSync(socketPath);
 assert.equal(realpathSync(parent),parent);assert.ok(directory.isDirectory()&&!directory.isSymbolicLink());assert.equal(directory.uid,0);assert.equal(directory.mode&0o022,0);
 assert.ok(entry.isSocket()&&!entry.isSymbolicLink());assert.equal(entry.uid,process.getuid());assert.equal(entry.mode&0o077,0);
 const socket=createConnection(socketPath);let buffer='',pending=null,failed=null;
 const fail=error=>{failed=error;if(pending){const p=pending;pending=null;clearTimeout(p.timer);p.reject(error);}};
 socket.on('error',fail);socket.on('end',()=>fail(Error('recorder EOF')));
 socket.on('data',bytes=>{
  buffer+=bytes.toString('utf8');if(Buffer.byteLength(buffer)>8192){fail(Error('bounded control response'));socket.destroy();return;}
  const cut=buffer.indexOf('\n');if(cut<0)return;
  if(!pending||buffer.slice(cut+1).length){fail(Error('unsolicited or duplicate ACK'));socket.destroy();return;}
  const p=pending;pending=null;clearTimeout(p.timer);const line=buffer.slice(0,cut);buffer='';
  try{p.resolve(JSON.parse(line));}catch(error){p.reject(error);}
 });
 return {
  async exchange(message){
   assert.equal(pending,null);if(failed)throw failed;assert.equal(buffer,'');
   const now=lstatSync(parent);assert.deepEqual([now.dev,now.ino,now.uid,now.mode],[directory.dev,directory.ino,directory.uid,directory.mode]);
   const raw=JSON.stringify(message)+'\n';assert.ok(Buffer.byteLength(raw)<=4096);
   return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending=null;failed=Error('bounded recorder ACK timeout');socket.destroy();reject(failed);},5000);pending={resolve,reject,timer};socket.write(raw,error=>{if(error)fail(error);});});
  },
  close(){if(pending)fail(Error('controller cleanup with pending ACK'));socket.destroy();},
 };
}
/** Pure state machine dependency seam for manufactured transport controls. */
export class WindowSession{
 constructor(io,clock=()=>process.hrtime.bigint().toString()){
  this.io=io;this.clock=clock;this.session=null;this.state='NEW';this.errors=[];this.records=[];this.sequence=0;this.begin=null;this.end=null;
 }
 async request(type,ack,extra={}){
  const seq=this.sequence++,before=this.clock();
  const response=await this.io.exchange({schema,type,seq,pid:process.pid,session:this.session,...extra});
  assert.deepEqual(Object.keys(response).sort(),['schema','type','seq','pid','session','controllerMonotonicNs',...(ack==='ready'?['proof']:[])].sort());
  assert.equal(response.schema,schema);assert.equal(response.type,ack);assert.equal(response.seq,seq);assert.equal(response.pid,process.pid);
  assert.match(response.session,/^[a-f0-9]{64}$/);if(this.session!==null)assert.equal(response.session,this.session);else this.session=response.session;
  assert.ok(decimal(response.controllerMonotonicNs));this.records.push({type,seq,workerBeforeNs:before,workerAfterNs:this.clock(),response});return response;
 }
 async prepare(){
  assert.equal(this.state,'NEW');const ready=await this.request('hello','ready');
  assert.deepEqual(Object.keys(ready.proof).sort(),['disabledAck','effectivePerfSha256','uid','gid','threadIds'].sort());
  assert.equal(ready.proof.disabledAck,true);assert.equal(ready.proof.effectivePerfSha256,perfImageSha256);assert.equal(ready.proof.uid,process.getuid());assert.equal(ready.proof.gid,process.getgid());
  assert.ok(Array.isArray(ready.proof.threadIds)&&ready.proof.threadIds.includes(process.pid)&&ready.proof.threadIds.every(x=>Number.isSafeInteger(x)&&x>0));this.state='DISABLED_READY';
 }
 async enable(){assert.equal(this.state,'DISABLED_READY');await this.request('enable','enabled');this.state='ENABLED';this.begin=this.clock();}
 async stop(){
  if(this.state==='STOPPED')return;
  this.end=this.clock();
  try{if(this.state==='ENABLED')await this.request('disable','disabled',{beginNs:this.begin,endNs:this.end});}
  catch(error){this.errors.push({phase:'disable',error:String(error)});}
  finally{try{this.io.close();}catch(error){this.errors.push({phase:'disconnect',error:String(error)});}this.state='STOPPED';}
 }
 report(){return {schema:'bw.cold-ledger-scalars.native-symbol.window.v1',status:this.errors.length?'FAIL':this.state==='STOPPED'&&this.begin!==null?'CONTROL_WINDOW_CLOSED_UNQUALIFIED_CLOCK_DOMAIN':'INCOMPLETE',records:this.records,errors:this.errors,beginOutsideTimerNs:this.begin,endOutsideTimerNs:this.end,clockScope:'Node hrtime markers are separate from recorder ACK/event-transition times; conservative control interval only until same-clock proof',scope:'DIAGNOSTIC_OBSERVER_ACTIVE_NOT_SPEED_QUALIFICATION; no native costshare or removable-cost claim'};}
 assertComplete(){assert.equal(this.report().status,'CONTROL_WINDOW_CLOSED_UNQUALIFIED_CLOCK_DOMAIN');assert.equal(this.records.length,3);}
}
export function createOwnedWindowSession(){return new WindowSession(transport());}
