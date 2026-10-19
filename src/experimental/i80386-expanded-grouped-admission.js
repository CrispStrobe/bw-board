// Shadow grammar only: inspect bytes and bus accesses from a completed ordinary step.
import {classifyI80386FormResolvedAdmission} from './i80386-form-resolved-admission.js';

const SPECIAL=new Set([0x8e,0xe8,0xc3,0xff]);
const fail=(base,reason)=>({...base,reason,formKey:null});
const bytesOf=(trace,kind)=>trace.filter(item=>item.kind===kind);
const contiguous=items=>items.every((item,index)=>
  index===0||item.address===(items[index-1].address+1)>>>0);
const valueOf=items=>items.reduce((value,item,index)=>
  value+item.value*2**(8*index),0)>>>0;
const sameBytes=(items,value)=>items.every((item,index)=>
  item.value===((value>>>8*index)&255));

export function classifyI80386ExpandedGroupedAdmission(bytes,options={}){
  const {mode='real',default32=false,startEip=0,postEip=0,
    dataTrace=[],dataTraceOverflow=false,dataPageCrossing=false,io=false,
    registers16=null,esAfter=undefined,espBefore=undefined,
    espAfter=undefined,stack32=false,stackBase=undefined,paging=false}=options;
  const opcode=bytes[0];
  if(!SPECIAL.has(opcode)||opcode===0xff&&bytes[1]!==undefined&&
      ((bytes[1]>>>3)&7)!==2)
    return classifyI80386FormResolvedAdmission(bytes,{...options,
      groupedShadowAdmission:true});
  const width=default32?32:16,size=width>>>3;
  const base={opcode:opcode?.toString(16).padStart(2,'0')??'??',
    prefixSignature:'-/-/-',operandWidth:opcode===0x8e?16:width,
    addressWidth:width,modrm:null,eaClass:'none',accessClass:'none',
    special:true};
  if(dataTraceOverflow)return fail(base,'access-trace-overflow');
  if(io)return fail(base,'unexpected-port-io');
  if(dataPageCrossing)return fail(base,'data-page-crossing');
  const reads=bytesOf(dataTrace,'read'),writes=bytesOf(dataTrace,'write');
  const stackTraffic=(items,push)=>{
    if(espBefore===undefined||espAfter===undefined)return true;
    const before=stack32?espBefore>>>0:espBefore&0xffff;
    const expected=stack32?(push?before-size:before+size)>>>0:
      (push?before-size:before+size)&0xffff;
    if((stack32?espAfter>>>0:espAfter&0xffff)!==expected)return false;
    if(paging||stackBase===undefined)return true;
    const first=push?expected:before;
    return items.every((item,index)=>item.address===
      ((stackBase+(stack32?first+index:(first+index)&0xffff))>>>0));
  };
  if(opcode===0xe8){
    if(bytes.length!==1+size)return fail(base,'instruction-length');
    const immediate=valueOf(bytes.slice(1).map(value=>({value})));
    const next=(startEip+bytes.length)>>>0;
    const displacement=size===2?(immediate<<16)>>16:immediate|0;
    const target=default32?(next+displacement)>>>0:
      (next+displacement)&0xffff;
    if(postEip!==target)return fail(base,'unexpected-control-successor');
    if(reads.length||writes.length!==size||!contiguous(writes)||
        !stackTraffic(writes,true)||
        !sameBytes(writes,next))return fail(base,'call-stack-traffic');
    return {...base,eaClass:'implicit-stack-or-control',accessClass:'ram-write',
      formKey:`e8:-/-/-:o${width}:a${width}:-:ram-write`,reason:null};
  }
  if(opcode===0xc3){
    if(bytes.length!==1)return fail(base,'instruction-length');
    if(writes.length||reads.length!==size||!contiguous(reads)||
        !stackTraffic(reads,false)||
        (default32?valueOf(reads):valueOf(reads)&0xffff)!==postEip)
      return fail(base,'return-stack-traffic');
    return {...base,eaClass:'implicit-stack-or-control',accessClass:'ram-read',
      formKey:`c3:-/-/-:o${width}:a${width}:-:ram-read`,reason:null};
  }
  if(bytes[1]===undefined)return fail(base,'missing-modrm');
  const mod=bytes[1]>>>6,reg=bytes[1]>>>3&7,rm=bytes[1]&7;
  if(opcode===0x8e&&reg!==0)return fail(base,'deferred-other-segment');
  if(opcode===0xff&&mod===3)
    return fail(base,'deferred-register-indirect-call');
  let at=2,sib=null,displacementBytes=0;
  if(mod!==3){
    displacementBytes=mod===1?1:mod===2?(default32?4:2):0;
    if(default32){
      if(rm===4){
        if(bytes[at]===undefined)return fail(base,'missing-sib');
        sib=bytes[at++];
        if(mod===0&&(sib&7)===5)displacementBytes=4;
      }else if(mod===0&&rm===5)displacementBytes=4;
    }else if(mod===0&&rm===6)displacementBytes=2;
  }
  if(bytes.length!==at+displacementBytes)
    return fail(base,'instruction-length');
  const modrm={mod,reg,rm,sib:sib===null?null:{scale:sib>>>6,
    index:sib>>>3&7,base:sib&7},displacementBytes};
  base.modrm=modrm;
  base.eaClass=mod===3?'register':
    `mem${width}${sib===null?'':'-sib'}-disp${displacementBytes*8}`;
  const sourceSize=opcode===0x8e?2:size;
  const sourceReads=mod===3?0:sourceSize;
  if(reads.length<sourceReads||!contiguous(reads.slice(0,sourceReads))||
      dataTrace.slice(0,sourceReads).some(item=>item.kind!=='read'))
    return fail(base,'source-read-traffic');
  if(opcode===0x8e){
    const sourceSelector=mod===3?registers16?.[rm]:valueOf(reads.slice(0,2));
    if(esAfter!==undefined&&sourceSelector!==esAfter)
      return fail(base,'segment-source-selector-mismatch');
    if(mode==='protected16'||mode==='protected32'){
      const descriptor=reads.slice(sourceReads);
      if(descriptor.length!==8||!contiguous(descriptor)||
          dataTrace.slice(sourceReads,sourceReads+8)
            .some(item=>item.kind!=='read')||
          (writes.length===0&&!(descriptor[5]?.value&1))||
          (writes.length!==0&&
            (writes.length!==1||writes[0].address!==
              ((descriptor[0].address+5)>>>0)||
              (descriptor[5].value&1)!==0||
              writes[0].value!==(descriptor[5].value|1))))
        return fail(base,'descriptor-access-traffic');
    }else if(reads.length!==sourceReads||writes.length)
      return fail(base,'segment-load-traffic');
    base.accessClass=reads.length&&writes.length?'ram-read+write':
      reads.length?'ram-read':'register';
  }else{
    if(reads.length!==size||writes.length!==size||
        dataTrace.slice(0,size).some(item=>item.kind!=='read')||
        dataTrace.slice(size).some(item=>item.kind!=='write')||
        !contiguous(writes)||!stackTraffic(writes,true)||!sameBytes(writes,
          (startEip+bytes.length)>>>0)||
        valueOf(reads)!==postEip)
      return fail(base,'indirect-call-traffic');
    base.accessClass='ram-read+write';
  }
  const modrmKey=`m${mod}r${reg}b${rm}`+
    (sib===null?'':`s${sib>>>6}${sib>>>3&7}${sib&7}`)+
    `d${displacementBytes}`;
  return {...base,formKey:`${base.opcode}:-/-/-:o${base.operandWidth}`+
    `:a${width}:${modrmKey}:${base.accessClass}`,reason:null};
}
