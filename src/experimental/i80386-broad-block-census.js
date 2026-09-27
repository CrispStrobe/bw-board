// Observation-only census. Classify bytes fetched by ordinary execution; never
// decode ahead, translate an address, or read guest memory for this diagnostic.
const PREFIXES=new Set([0x26,0x2e,0x36,0x3e,0x64,0x65,0x66,0x67,0xf0,0xf2,0xf3]);
const LINEAR=new Set([0x01,0x03,0x09,0x0b,0x21,0x23,0x29,0x2b,0x31,0x33,
  0x39,0x3b,0x80,0x81,0x83,0x85,0x88,0x89,0x8a,0x8b,0x8d,0xc0,0xc1,
  0xd0,0xd1,0xd2,0xd3,0x90]);
const TERMINAL=new Set([0xc2,0xc3,0xe8,0xe9,0xeb]);
const STRING=new Set([0xa4,0xa5,0xaa,0xab,0xac,0xad,0xae,0xaf]);
const MODRM=new Set([...LINEAR].filter(op=>op!==0x90));
const MODES=['real','protected16','vm86','protected32'];
const bump=(object,key,by=1)=>{object[key]=(object[key]??0)+by;};
const modeOf=cpu=>!(cpu.cr0&1)?'real':(cpu.eflags&0x20000)?'vm86':
  cpu.segmentCaches[1].default32?'protected32':'protected16';
const linearOf=(cpu,eip)=>((cpu.segmentCaches[1].base??0)+(eip>>>0))>>>0;

// This is an opcode-family hypothesis, not a semantic or fault-safety proof.
export function classifyI80386BroadForm(bytes) {
  let at=0,repeat=false,lock=false;
  while(at<bytes.length&&PREFIXES.has(bytes[at])){
    repeat ||= bytes[at]===0xf2||bytes[at]===0xf3;
    lock ||= bytes[at]===0xf0;
    at++;
  }
  if(lock)return {reason:'lock-prefix'};
  if(at===bytes.length)return {reason:'missing-opcode'};
  const op=bytes[at],next=bytes[at+1];
  if(repeat&&!STRING.has(op))return {reason:'repeat-non-string'};
  if(STRING.has(op))return {kind:'string-exit'};
  if(op===0x0f){
    if(next>=0x80&&next<=0x8f)return {kind:'control-flow'};
    return {reason:'unsupported-0f'};
  }
  if(op>=0x70&&op<=0x7f||TERMINAL.has(op))return {kind:'control-flow'};
  if(op>=0x40&&op<=0x5f||op>=0xb8&&op<=0xbf||LINEAR.has(op)){
    if(MODRM.has(op)&&next===undefined)return {reason:'missing-modrm'};
    return {kind:'linear'};
  }
  return {reason:'unsupported-opcode'};
}

export function createI80386BroadBlockCensus({maxRun=64}={}){
  if(!Number.isInteger(maxRun)||maxRun<1||maxRun>256)
    throw new RangeError('broad-block census run budget must be 1..256');
  const modes=Object.fromEntries(MODES.map(mode=>[mode,{
    entryAttempts:0,retiredSteps:0,potentialSteps:0,nonCandidateSteps:0,
    runs:0,runLengthHistogram:{},runEndReasons:{},firstRefusals:{},
    forms:{},redirectedSteps:0,noRetirement:0,abortedCalls:0,
  }]));
  let machine=null,fetch8=null,fetchN=null,own8=null,ownN=null,pending=null;
  let bytes=[],run=null;
  const endRun=reason=>{
    if(!run)return;
    const bucket=modes[run.mode];
    bucket.runs++;
    bump(bucket.runLengthHistogram,run.length);
    bump(bucket.runEndReasons,reason);
    run=null;
  };
  const recordByte=(cpu,eip,value)=>{
    if(!pending||bytes.length>=15)return;
    if(bytes.length===0){pending.fetchCs=cpu.cs;pending.fetchEip=eip>>>0;}
    bytes.push(value&255);
  };
  return {
    attach(target){
      if(machine||!target?.cpu||typeof target.cpu._fetch8!=='function'||
          typeof target.cpu._fetchN!=='function')
        throw new TypeError('broad-block census needs an unattached 386 CPU');
      machine=target;
      const cpu=target.cpu;
      fetch8=cpu._fetch8;fetchN=cpu._fetchN;
      own8=Object.getOwnPropertyDescriptor(cpu,'_fetch8');
      ownN=Object.getOwnPropertyDescriptor(cpu,'_fetchN');
      const wrapped8=function(...args){
        const eip=this.eip,value=fetch8.apply(this,args);
        recordByte(this,eip,value);
        return value;
      };
      const wrappedN=function(size,...args){
        const eip=this.eip,before=bytes.length,value=fetchN.call(this,size,...args);
        // _fetchN uses _fetch8 at boundaries; its fast path bypasses it.
        if(pending&&bytes.length===before)
          for(let i=0;i<size;i++)recordByte(this,eip+i,value/(2**(8*i))&255);
        return value;
      };
      cpu._fetch8=wrapped8;cpu._fetchN=wrappedN;
      return ()=>{
        if(cpu._fetch8===wrapped8){if(own8)Object.defineProperty(cpu,'_fetch8',own8);else delete cpu._fetch8;}
        if(cpu._fetchN===wrappedN){if(ownN)Object.defineProperty(cpu,'_fetchN',ownN);else delete cpu._fetchN;}
        endRun('end-of-observation');machine=null;pending=null;
      };
    },
    observe(target){
      if(target!==machine)throw new TypeError('broad-block census is not attached');
      if(pending)throw new Error('broad-block census step was not completed');
      const cpu=target.cpu,mode=modeOf(cpu),eip=cpu.eip>>>0;
      pending={mode,cs:cpu.cs,eip,linear:linearOf(cpu,eip),cycles:cpu.cycles,
        fetchCs:null,fetchEip:null};
      bytes=[];modes[mode].entryAttempts++;
    },
    retired(target){
      if(target!==machine||!pending)throw new TypeError('broad-block census has no pending step');
      const before=pending,cpu=target.cpu,bucket=modes[before.mode];
      pending=null;
      if(cpu.cycles===before.cycles){bucket.noRetirement++;endRun('no-retirement');return;}
      bucket.retiredSteps++;
      if(before.fetchCs!==before.cs||before.fetchEip!==before.eip){
        bucket.redirectedSteps++;bucket.nonCandidateSteps++;
        bump(bucket.firstRefusals,'entry-redirect');endRun('entry-redirect');return;
      }
      if(run&&(run.mode!==before.mode||run.cs!==before.cs||
          run.nextEip!==before.eip||run.page!==(before.linear>>>12)))
        endRun(run.mode!==before.mode?'mode-change':run.cs!==before.cs?'cs-change':
          run.page!==(before.linear>>>12)?'linear-page-change':'nonsequential-entry');
      const form=classifyI80386BroadForm(bytes);
      const lastLinear=(before.linear+bytes.length-1)>>>0;
      const reason=bytes.length===0?'missing-fetch':
        (before.linear>>>12)!==(lastLinear>>>12)?'instruction-page-crossing':
        form.reason??null;
      if(reason){
        bucket.nonCandidateSteps++;bump(bucket.firstRefusals,reason);endRun(reason);return;
      }
      if(!run)run={mode:before.mode,cs:before.cs,page:before.linear>>>12,length:0};
      run.length++;run.nextEip=cpu.eip>>>0;
      bucket.potentialSteps++;bump(bucket.forms,form.kind);
      if(form.kind!=='linear')endRun(form.kind);
      else if(run.length===maxRun)endRun('run-budget');
    },
    aborted(target){
      if(target!==machine||!pending)throw new TypeError('broad-block census has no pending step');
      modes[pending.mode].abortedCalls++;
      pending=null;endRun('aborted-call');
    },
    report(){return {schema:'bw.i80386-broad-block-census.v1',maxRun,modes};},
  };
}
