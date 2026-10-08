// Source-only transaction model. Its caller-supplied records are not CPU proof.
const MAX_CAPACITY=64;
const GPRS=['eax','ecx','edx','ebx','esp','ebp','esi','edi'];
const U32=n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff;
const U16=n=>Number.isInteger(n)&&n>=0&&n<=0xffff;
const U8=n=>Number.isInteger(n)&&n>=0&&n<=0xff;
const own=(o,k)=>{
  const d=o&&typeof o==='object'&&Object.getOwnPropertyDescriptor(o,k);
  if(!d||!Object.hasOwn(d,'value'))throw new Error(`non-data ${k}`);
  return d.value;
};
function scalar(o,k,predicate=U32){
  const n=own(o,k);
  if(!predicate(n))throw new Error(`invalid ${k}`);
  return n;
}
function state(input){
  const result={cs:scalar(input,'cs',U16),ss:scalar(input,'ss',U16),
    eip:scalar(input,'eip'),eflags:scalar(input,'eflags'),
    cpl:scalar(input,'cpl',n=>Number.isInteger(n)&&n>=0&&n<=3),
    cr0:scalar(input,'cr0',n=>Number.isInteger(n)&&n>=-0x80000000&&n<=0xffffffff),
    cr3:scalar(input,'cr3'),cr4:scalar(input,'cr4')};
  for(const key of GPRS)result[key]=scalar(input,key);
  if(!(result.cr0&1)||(result.eflags&0x24000))
    throw new Error('real/VM86/nested-task profile unsupported');
  return result;
}
function frame(input){
  const gateType=scalar(input,'gateType',n=>[6,7,14,15].includes(n));
  const width=scalar(input,'width',n=>n===16||n===32);
  if((gateType>=14?32:16)!==width)throw new Error('gate width mismatch');
  const result={gateType,width,oldCpl:scalar(input,'oldCpl',n=>Number.isInteger(n)&&n>=0&&n<=3),
    newCpl:scalar(input,'newCpl',n=>Number.isInteger(n)&&n>=0&&n<=3),
    returnCs:scalar(input,'returnCs',U16),returnEip:scalar(input,'returnEip'),
    returnSs:scalar(input,'returnSs',U16),returnEsp:scalar(input,'returnEsp'),
    returnFlags:scalar(input,'returnFlags'),
    handlerCs:scalar(input,'handlerCs',U16),handlerEip:scalar(input,'handlerEip'),
    frameSs:scalar(input,'frameSs',U16),
    frameEsp:scalar(input,'frameEsp')};
  if(result.newCpl>result.oldCpl)throw new Error('interrupt privilege escalation');
  return result;
}
function delivery(input,kind){
  const source=own(input,'source');
  if(source!==kind)throw new Error('delivery source mismatch');
  const vector=scalar(input,'vector',U8);
  const before=state(own(input,'before')),after=state(own(input,'after'));
  const saved=frame(own(input,'frame'));
  if(before.cpl!==saved.oldCpl||after.cpl!==saved.newCpl||
     before.cs!==saved.returnCs||before.ss!==saved.returnSs||
     before.esp!==saved.returnEsp||before.eflags!==saved.returnFlags||
     after.cs!==saved.handlerCs||after.eip!==saved.handlerEip||
     after.ss!==saved.frameSs||
     after.esp!==saved.frameEsp||saved.returnEip!==scalar(input,'returnEip'))
    throw new Error('delivery frame/state mismatch');
  const record={kind:'delivery',source,vector,
    opcode:null,instructionStart:null,returnEip:saved.returnEip,
    before,after,frame:saved};
  if(kind==='software'){
    const opcode=scalar(input,'opcode',U8);
    if(![0xcc,0xcd,0xce].includes(opcode)||
       (opcode===0xcc&&vector!==3)||(opcode===0xce&&vector!==4))
      throw new Error('software opcode/vector mismatch');
    record.opcode=opcode;
    record.instructionStart=scalar(input,'instructionStart');
    if(before.eip!==record.instructionStart)
      throw new Error('source instruction mismatch');
  }
  return record;
}
function iret(input,top){
  if(!top)throw new Error('IRET without committed delivery');
  const before=state(own(input,'before')),after=state(own(input,'after'));
  const width=scalar(input,'width',n=>n===16||n===32);
  const observed=frame(own(input,'frame'));
  if(width!==top.frame.width||JSON.stringify(observed)!==JSON.stringify(top.frame)||
     before.cs!==top.after.cs||before.cpl!==top.after.cpl||
     after.cs!==top.frame.returnCs||after.eip!==top.frame.returnEip||
     after.ss!==top.frame.returnSs||after.esp!==top.frame.returnEsp||
     after.cpl!==top.frame.oldCpl)
    throw new Error('IRET frame/return mismatch');
  return {kind:'iret',deliveryId:top.id,source:top.source,width,before,after,
    frame:observed};
}

export class InterruptJournalModel {
  #capacity;#queue=[];#frames=[];#active=null;#tickets=new WeakMap();
  #session=Symbol('journal session');#sequence=0;#failed=false;#busy=false;
  constructor(capacity=32){
    if(!Number.isInteger(capacity)||capacity<1||capacity>MAX_CAPACITY)
      throw new Error('bounded journal capacity');
    this.#capacity=capacity;
  }
  #exclusive(action){
    if(this.#busy){this.#failed=true;throw new Error('journal reentry');}
    this.#busy=true;
    try{return action();}finally{this.#busy=false;}
  }
  #usable(){if(this.#failed)throw new Error('journal terminal failure');}
  #ticket(ticket){
    if(!ticket||this.#tickets.get(ticket)!==this.#session||
       ticket!==this.#active?.ticket)throw new Error('stale/foreign journal ticket');
  }
  begin(kind){return this.#exclusive(()=>{
    this.#usable();
    if(this.#active||!['step','external'].includes(kind)||this.#queue.length>=this.#capacity)
      throw new Error('journal boundary unavailable');
    const ticket=Object.freeze({});this.#tickets.set(ticket,this.#session);
    this.#active={ticket,kind,record:null};return ticket;
  });}
  stageDelivery(ticket,input){return this.#exclusive(()=>{
    this.#usable();
    try{
      this.#ticket(ticket);
      if(this.#active.record)throw new Error('duplicate staged event');
      const source=this.#active.kind==='external'?'hardware':'software';
      this.#active.record=delivery(input,source);
    }catch(error){this.#failed=true;throw error;}
  });}
  stageIret(ticket,input){return this.#exclusive(()=>{
    this.#usable();
    try{
      this.#ticket(ticket);
      if(this.#active.kind!=='step'||this.#active.record)
        throw new Error('IRET outside one-step boundary');
      this.#active.record=iret(input,this.#frames.at(-1));
    }catch(error){this.#failed=true;throw error;}
  });}
  commit(ticket){return this.#exclusive(()=>{
    this.#usable();
    try{
      this.#ticket(ticket);
      const {kind,record}=this.#active;
      if(!record){
        if(kind==='external')throw new Error('external delivery not confirmed');
        this.#active=null;return null;
      }
      if(this.#queue.length>=this.#capacity)throw new Error('journal capacity after effect');
      if(kind==='external'&&record.source!=='hardware')throw new Error('external source');
      const emitted={...record,id:++this.#sequence};
      if(record.kind==='delivery')this.#frames.push(emitted);
      else if(this.#frames.at(-1)?.id===record.deliveryId)this.#frames.pop();
      else throw new Error('nested frame changed');
      this.#queue.push(emitted);this.#active=null;
      return emitted.id;
    }catch(error){this.#failed=true;throw error;}
  });}
  discard(ticket,{rollback=false}={}){return this.#exclusive(()=>{
    this.#usable();
    try{
      this.#ticket(ticket);
      // Only an authenticated rollback may discard a post-effect stage.
      if(this.#active.record&&!rollback)this.#failed=true;
      this.#active=null;
      if(this.#failed)throw new Error('ambiguous post-effect boundary');
    }catch(error){this.#failed=true;throw error;}
  });}
  drain(){return this.#exclusive(()=>{
    this.#usable();
    if(this.#active)throw new Error('cannot drain active boundary');
    const out=this.#queue.map(record=>structuredClone(record));
    this.#queue=[];return out;
  });}
  status(){return this.#exclusive(()=>({failed:this.#failed,
    pending:this.#queue.length,active:!!this.#active,openFrames:this.#frames.length,
    sequence:this.#sequence}));}
}
