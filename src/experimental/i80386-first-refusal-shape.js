// Diagnostic syntax only: classify bytes already fetched by ordinary execution.
// Unknown opcodes have unknown ModR/M shape; observed accesses are not an EA proof.
const PREFIXES=new Set([0x26,0x2e,0x36,0x3e,0x64,0x65,0x66,0x67,0xf0,0xf2,0xf3]);
const MODRM=new Set([0x80,0x81,0x83,0x8c,0x8e,0x8f,0xc0,0xc1,0xc6,0xc7,
  0xd0,0xd1,0xd2,0xd3,0xf6,0xf7,0xfe,0xff,
  0x62,0x63,0x69,0x6b,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x8b,
  0x8d,0xc4,0xc5,
  ...Array.from({length:8},(_,i)=>0xd8+i),
  ...Array.from({length:8},(_,i)=>0x38+i).filter(x=>x<=0x3b),
  ...Array.from({length:8},(_,i)=>0x30+i).filter(x=>x<=0x33),
  ...Array.from({length:8},(_,i)=>0x28+i).filter(x=>x<=0x2b),
  ...Array.from({length:8},(_,i)=>0x20+i).filter(x=>x<=0x23),
  ...Array.from({length:8},(_,i)=>0x18+i).filter(x=>x<=0x1b),
  ...Array.from({length:8},(_,i)=>0x10+i).filter(x=>x<=0x13),
  ...Array.from({length:8},(_,i)=>0x08+i).filter(x=>x<=0x0b),
  ...Array.from({length:8},(_,i)=>0x00+i).filter(x=>x<=0x03)]);
const MODRM_0F=new Set([0x01,0x20,0x21,0x22,0x23,0xa3,0xab,0xaf,
  0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xba,0xbb,0xbe,0xbf,
  ...Array.from({length:16},(_,i)=>0x40+i),
  ...Array.from({length:16},(_,i)=>0x90+i)]);
const hex=value=>value===undefined?'??':value.toString(16).padStart(2,'0');

export function classifyI80386FirstRefusalShape(bytes,{
  default32=false,dataReads=0,dataWrites=0,io=false}={}){
  if(!Array.isArray(bytes))throw new TypeError('fetched bytes must be an array');
  let at=0,operandOverride=0,addressOverride=0;
  while(at<bytes.length&&PREFIXES.has(bytes[at])){
    const prefix=bytes[at++];
    if(prefix===0x66)operandOverride++;
    else if(prefix===0x67)addressOverride++;
  }
  const primary=bytes[at++],secondary=primary===0x0f?bytes[at++]:undefined;
  const opcode=primary===0x0f?`0f${hex(secondary)}`:hex(primary);
  const operandWidth=(!!default32!==(operandOverride>0))?32:16;
  const addressWidth=(!!default32!==(addressOverride>0))?32:16;
  const prefixSignature=bytes.slice(0,primary===0x0f?at-2:at-1)
    .map(hex).join('-')||'-';
  const observedAccess=io?'port':dataReads&&dataWrites?'ram-read+write':
    dataReads?'ram-read':dataWrites?'ram-write':'none';
  let modrm=null,eaClass='unknown',parseStatus='not-declared-modrm';
  // For these primary opcodes the next byte is definitely ModR/M. The
  // diagnostic does not guess ModR/M for 0F escapes or unknown instructions.
  if(MODRM.has(primary)||primary===0x0f&&MODRM_0F.has(secondary)){
    if(at>=bytes.length)parseStatus='missing-modrm';
    else{
      const value=bytes[at++],mod=value>>>6,reg=(value>>>3)&7,rm=value&7;
      modrm={mod,reg,rm,sib:null,displacementBytes:0};
      parseStatus='shape-complete';
      if(mod===3)eaClass='register';
      else{
        let disp=mod===1?1:mod===2?(addressWidth===32?4:2):0;
        if(addressWidth===32){
          if(rm===4){
            if(at>=bytes.length)parseStatus='missing-sib';
            else{
              const sib=bytes[at++];
              modrm.sib={scale:sib>>>6,index:(sib>>>3)&7,base:sib&7};
              if(mod===0&&modrm.sib.base===5)disp=4;
            }
          }else if(mod===0&&rm===5)disp=4;
        }else if(mod===0&&rm===6)disp=2;
        modrm.displacementBytes=disp;
        if(parseStatus==='shape-complete'&&at+disp>bytes.length)
          parseStatus='missing-displacement';
        eaClass=`mem${addressWidth}${modrm.sib?'-sib':''}-disp${disp*8}`;
      }
    }
  }else if(primary>=0x50&&primary<=0x5f||primary===0x06||primary===0x07||
      [0x68,0x6a,0x9c,0x9d,0xe8,0xc2,0xc3,0xca,0xcb].includes(primary))
    eaClass='implicit-stack-or-control';
  const modrmKey=modrm?`m${modrm.mod}g${modrm.reg}b${modrm.rm}`+
    (modrm.sib?`s${modrm.sib.scale}${modrm.sib.index}${modrm.sib.base}`:'')+
    `d${modrm.displacementBytes}`:'-';
  const shapeKey=`${opcode}:${prefixSignature}:o${operandWidth}:a${addressWidth}`+
    `:${modrmKey}:${eaClass}:${observedAccess}:${parseStatus}`;
  return {opcode,prefixSignature,operandWidth,addressWidth,modrm,eaClass,
    observedAccess,parseStatus,shapeKey};
}

const MODES=['real','protected16','vm86','protected32'];
const bump=(map,key)=>{map[key]=(map[key]??0)+1;};
const GROUPED_TARGETS=new Set(['06','07','8e','e8','c1','c2','c3','ca','cb','ff',
  ...Array.from({length:16},(_,i)=>hex(0x50+i))]);
export const isI80386GroupedRefusalTarget=shape=>
  GROUPED_TARGETS.has(shape.opcode)||shape.opcode.startsWith('0f');

export function createI80386FirstRefusalContextTracker({maxRun=64,
  groupedTargetsOnly=false}={}){
  const modes=Object.fromEntries(MODES.map(mode=>[mode,{
    refusedOrdinals:0,unselectedRefusals:0,selectedRefusals:0,
    followingResolved:0,bridgeAtLeast4:0,
    bridgeAtLeast8:0,records:{},
  }]));
  const record=(mode,reason,shape,precedingLength)=>{
    const bucket=modes[mode];
    if(!bucket||!Number.isInteger(precedingLength)||precedingLength<0||
        precedingLength>maxRun)throw new RangeError('invalid refusal context');
    bucket.refusedOrdinals++;
    if(groupedTargetsOnly&&!isI80386GroupedRefusalTarget(shape)){
      bucket.unselectedRefusals++;
      return null;
    }
    bucket.selectedRefusals++;
    const key=`${reason}|${shape.shapeKey}`;
    const entry=bucket.records[key]??={reason,opcode:shape.opcode,
      prefixSignature:shape.prefixSignature,operandWidth:shape.operandWidth,
      addressWidth:shape.addressWidth,modrm:shape.modrm,
      eaClass:shape.eaClass,observedAccess:shape.observedAccess,
      parseStatus:shape.parseStatus,count:0,followingResolved:0,
      precedingLengthHistogram:{},followingLengthHistogram:{},
      followingEndReasons:{},bridgeAtLeast4:0,bridgeAtLeast8:0};
    entry.count++;
    bump(entry.precedingLengthHistogram,precedingLength);
    return {mode,key,precedingLength,resolved:false};
  };
  const resolve=(token,followingLength,endReason)=>{
    if(token.resolved||!Number.isInteger(followingLength)||followingLength<0||
        followingLength>maxRun)throw new RangeError('invalid following run context');
    const bucket=modes[token.mode],entry=bucket.records[token.key];
    token.resolved=true;bucket.followingResolved++;entry.followingResolved++;
    bump(entry.followingLengthHistogram,followingLength);
    bump(entry.followingEndReasons,endReason);
    if(token.precedingLength>=4&&followingLength>=4){
      bucket.bridgeAtLeast4++;entry.bridgeAtLeast4++;
    }
    if(token.precedingLength>=8&&followingLength>=8){
      bucket.bridgeAtLeast8++;entry.bridgeAtLeast8++;
    }
  };
  const report=eligibleByMode=>{
    for(const mode of MODES){
      const bucket=modes[mode];
      const records=Object.values(bucket.records);
      const sum=field=>records.reduce((n,entry)=>n+entry[field],0);
      if(bucket.refusedOrdinals!==eligibleByMode[mode]||
          bucket.unselectedRefusals+bucket.selectedRefusals!==bucket.refusedOrdinals||
          bucket.followingResolved!==bucket.selectedRefusals||
          sum('count')!==bucket.selectedRefusals||
          sum('followingResolved')!==bucket.selectedRefusals||
          sum('bridgeAtLeast4')!==bucket.bridgeAtLeast4||
          sum('bridgeAtLeast8')!==bucket.bridgeAtLeast8||
          records.some(entry=>Object.values(entry.precedingLengthHistogram)
            .reduce((a,b)=>a+b,0)!==entry.count||
            Object.values(entry.followingLengthHistogram)
              .reduce((a,b)=>a+b,0)!==entry.count||
            Object.values(entry.followingEndReasons)
              .reduce((a,b)=>a+b,0)!==entry.count))
        throw new Error(`first-refusal context partition mismatch in ${mode}`);
    }
    return {schema:groupedTargetsOnly?
      'bw.i80386-grouped-first-refusal-context.v1':
      'bw.i80386-first-refusal-context.v1',maxRun,modes,
      refusedOrdinals:MODES.reduce((n,m)=>n+modes[m].refusedOrdinals,0),
      selectedRefusals:MODES.reduce((n,m)=>n+modes[m].selectedRefusals,0),
      unselectedRefusals:MODES.reduce((n,m)=>n+modes[m].unselectedRefusals,0),
      bridgeAtLeast4:MODES.reduce((n,m)=>n+modes[m].bridgeAtLeast4,0),
      bridgeAtLeast8:MODES.reduce((n,m)=>n+modes[m].bridgeAtLeast8,0)};
  };
  return {record,resolve,report};
}
