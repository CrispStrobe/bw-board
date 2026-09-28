// Static shape of the typed candidate grammar. Bytes come only from the
// ordinary CPU's already completed fetch; this never decodes ahead.
const PREFIXES=new Set([0x26,0x2e,0x36,0x3e,0x64,0x65,0x66,0x67,0xf0,0xf2,0xf3]);
const SEGMENTS=new Set([0x26,0x2e,0x36,0x3e,0x64,0x65]);
const hex=byte=>byte?.toString(16).padStart(2,'0')??'??';
const MODRM_OPS=new Set([0x88,0x89,0x8a,0x8b,0x39,0x3a,0x3b,
  0x84,0x85,0x80,0x81,0x83]);
const IMM_OPS=new Set([0x3c,0x3d,0x80,0x81,0x83,0xe4,0xe6]);
const IO_OPS=new Set([0xe4,0xe6,0xec,0xee]);
const BYTE_OPS=new Set([0x88,0x8a,0x3a,0x84,0x3c,0x80,...IO_OPS]);
const CONTROL_OPS=new Set([0xeb,...Array.from({length:16},(_,i)=>0x70+i)]);
const SUPPORTED=new Set([...MODRM_OPS,...IMM_OPS,...IO_OPS,...CONTROL_OPS]);

export function classifyI80386FormResolvedAdmission(bytes,{
  default32=false,startEip=0,postEip=0,dataAccesses=0,
  dataReads=dataAccesses,dataWrites=dataAccesses,io=false,
  dataPageCrossing=false}={}){
  if(!Array.isArray(bytes))throw new TypeError('fetched bytes must be an array');
  let at=0,operandOverride=false,addressOverride=false,segment=null,
    invalidPrefix=null;
  while(at<bytes.length&&PREFIXES.has(bytes[at])){
    const prefix=bytes[at++];
    if(prefix===0x66){if(operandOverride)invalidPrefix='duplicate-prefix';operandOverride=true;}
    else if(prefix===0x67){if(addressOverride)invalidPrefix='duplicate-prefix';addressOverride=true;}
    else if(SEGMENTS.has(prefix)){
      if(segment!==null)invalidPrefix='duplicate-segment-prefix';
      segment=prefix;
    }else invalidPrefix='lock-or-repeat-prefix';
  }
  const opcode=bytes[at],operand32=!!default32!==operandOverride,
    address32=!!default32!==addressOverride;
  const prefixSignature=[segment===null?'-':hex(segment),
    operandOverride?'66':'-',addressOverride?'67':'-'].join('/');
  const base={opcode:hex(opcode),prefixSignature,
    operandWidth:BYTE_OPS.has(opcode)?8:operand32?32:16,
    addressWidth:address32?32:16,
    modrm:null,eaClass:'none',accessClass:'none',formKey:null};
  const refusal=reason=>({...base,reason});
  if(invalidPrefix)return refusal(invalidPrefix);
  if(opcode===undefined)return refusal('missing-opcode');
  if(!SUPPORTED.has(opcode))return refusal('unsupported-opcode');
  if((IO_OPS.has(opcode)||CONTROL_OPS.has(opcode))&&at)
    return refusal('prefixed-io-or-control');
  at++;
  let modrm=null,eaClass='none',accessClass='register';
  if(MODRM_OPS.has(opcode)){
    if(at>=bytes.length)return refusal('missing-modrm');
    const value=bytes[at++],mod=value>>>6,reg=(value>>>3)&7,rm=value&7;
    modrm={mod,reg,rm,sib:null,displacementBytes:0};
    if([0x80,0x81,0x83].includes(opcode)&&reg!==7){
      base.modrm=modrm;return refusal('unsupported-group-extension');
    }
    if(mod===3)eaClass='register';
    else{
      let displacementBytes=mod===1?1:mod===2?(address32?4:2):0;
      if(address32){
        if(rm===4){
          if(at>=bytes.length){base.modrm=modrm;return refusal('missing-sib');}
          const sib=bytes[at++];
          modrm.sib={scale:sib>>>6,index:(sib>>>3)&7,base:sib&7};
          if(mod===0&&modrm.sib.base===5)displacementBytes=4;
        }else if(mod===0&&rm===5)displacementBytes=4;
      }else if(mod===0&&rm===6)displacementBytes=2;
      modrm.displacementBytes=displacementBytes;
      if(at+displacementBytes>bytes.length){
        base.modrm=modrm;return refusal('missing-displacement');
      }
      at+=displacementBytes;
      eaClass=`mem${address32?32:16}${modrm.sib?'-sib':''}-disp${displacementBytes*8}`;
      accessClass=[0x88,0x89].includes(opcode)?'ram-write':'ram-read';
    }
  }
  const immediateBytes=IMM_OPS.has(opcode)?
    [0x3d,0x81].includes(opcode)?(operand32?4:2):1:
    CONTROL_OPS.has(opcode)?1:0;
  if(at+immediateBytes!==bytes.length){
    base.modrm=modrm;base.eaClass=eaClass;base.accessClass=accessClass;
    return refusal(at+immediateBytes>bytes.length?'missing-immediate':'extra-fetched-bytes');
  }
  if(IO_OPS.has(opcode))accessClass=opcode===0xe4||opcode===0xec?
    'port-read':'port-write';
  else if(CONTROL_OPS.has(opcode))accessClass='control';
  const form={...base,modrm,eaClass,accessClass};
  const formRefusal=reason=>({...form,reason});
  if(dataPageCrossing&&accessClass.startsWith('ram-'))
    return formRefusal('data-page-crossing');
  if(accessClass==='ram-read'&&!dataReads||
      accessClass==='ram-write'&&!dataWrites)
    return formRefusal('unproved-memory-access');
  if((accessClass==='register'||accessClass==='control')&&dataAccesses)
    return formRefusal('unexpected-memory-access');
  if(accessClass.startsWith('port-')&&!io)return formRefusal('unproved-port-io');
  if(!accessClass.startsWith('port-')&&io)return formRefusal('unexpected-port-io');
  const fallthrough=(startEip+bytes.length)>>>0;
  if(CONTROL_OPS.has(opcode)){
    const displacement=(bytes.at(-1)<<24)>>24;
    const target=operand32?(fallthrough+displacement)>>>0:
      (fallthrough+displacement)&0xffff;
    if(opcode===0xeb?postEip!==target:
        postEip!==target&&postEip!==fallthrough)
      return formRefusal('unexpected-control-successor');
  }else if(postEip!==fallthrough)return formRefusal('unexpected-linear-successor');
  const modrmKey=modrm?`m${modrm.mod}r${modrm.reg}b${modrm.rm}`+
    (modrm.sib?`s${modrm.sib.scale}${modrm.sib.index}${modrm.sib.base}`:'')+
    `d${modrm.displacementBytes}`:'-';
  return {...form,formKey:`${hex(opcode)}:${prefixSignature}:o${form.operandWidth}`+
    `:a${form.addressWidth}:${modrmKey}:${accessClass}`,
    reason:null};
}
