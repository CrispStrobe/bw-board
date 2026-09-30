// Bounded PUSH/POP register grammar over an already completed ordinary step.
import {classifyI80386ExpandedGroupedAdmission} from './i80386-expanded-grouped-admission.js';

const REGISTERS=8;
const valueOf=items=>items.reduce((value,item,index)=>
  value+item.value*2**(8*index),0)>>>0;

export function classifyI80386RegisterStackAdmission(bytes,options={}){
  const opcode=bytes[0]===0x66?bytes[1]:bytes[0];
  if(opcode===undefined||opcode<0x50||opcode>0x5f||
      bytes[0]!==opcode&&bytes[0]!==0x66)
    return classifyI80386ExpandedGroupedAdmission(bytes,options);
  const prefixed=bytes[0]===0x66;
  const width=(!!options.default32!==prefixed)?32:16,size=width>>>3;
  const push=opcode<0x58,register=opcode&7;
  const base={opcode:opcode.toString(16),
    prefixSignature:prefixed?'-/66/-':'-/-/-',
    operandWidth:width,addressWidth:options.default32?32:16,
    modrm:null,eaClass:'implicit-stack-or-control',
    accessClass:push?'ram-write':'ram-read',special:true,formKey:null};
  const refuse=reason=>({...base,reason});
  if(bytes.length!==(prefixed?2:1))return refuse('instruction-length');
  if(options.dataTraceOverflow)return refuse('access-trace-overflow');
  if(options.io)return refuse('unexpected-port-io');
  if(options.dataPageCrossing)return refuse('data-page-crossing');
  const before=options.registersBefore,after=options.registersAfter;
  if(!Array.isArray(before)||before.length!==REGISTERS||
      !Array.isArray(after)||after.length!==REGISTERS||
      options.espBefore===undefined||options.espAfter===undefined||
      options.stackBase===undefined||options.flagsBefore===undefined||
      options.flagsAfter===undefined||!Array.isArray(options.dataTrace))
    return refuse('missing-register-stack-proof');
  if((before[4]>>>0)!==(options.espBefore>>>0)||
      (after[4]>>>0)!==(options.espAfter>>>0))
    return refuse('inconsistent-stack-pointer-proof');
  if(options.flagsBefore!==options.flagsAfter)
    return refuse('stack-flags-change');
  const expectedEip=options.default32?
    (options.startEip+bytes.length)>>>0:
    (options.startEip+bytes.length)&0xffff;
  if(options.postEip!==expectedEip)
    return refuse('unexpected-linear-successor');
  const trace=options.dataTrace;
  if(trace.length!==size||trace.some(item=>
      item.kind!==(push?'write':'read')||
      !Number.isInteger(item.value)||item.value<0||item.value>255))
    return refuse('register-stack-traffic');
  const esp=options.espBefore>>>0;
  const stack32=!!options.stack32;
  const stackOffset=stack32?esp:esp&0xffff;
  const nextOffset=stack32?
    (stackOffset+(push?-size:size))>>>0:
    (stackOffset+(push?-size:size))&0xffff;
  const accessOffset=push?nextOffset:stackOffset;
  // With paging the bus address is translated. The ordinary completed opcode
  // and one-page global cut prove the traffic class, but no linear=physical
  // claim is made. Require the observed physical bytes to stay contiguous.
  if(trace.some((item,index)=>item.address!==
      (options.paging?(trace[0].address+index)>>>0:
        ((options.stackBase+(stack32?accessOffset+index:
          (accessOffset+index)&0xffff))>>>0))))
    return refuse('register-stack-traffic');
  const observed=valueOf(trace);
  const mask=width===16?0xffff:0xffffffff;
  if(push&&observed!==((before[register]&mask)>>>0))
    return refuse('push-register-value');
  const advancedEsp=stack32?nextOffset:
    (esp&0xffff0000)|nextOffset;
  const expectedEsp=!push&&register===4?
    width===32?observed:
      (advancedEsp&0xffff0000)|(observed&0xffff):advancedEsp;
  if((options.espAfter>>>0)!==(expectedEsp>>>0))
    return refuse('stack-pointer-result');
  for(let index=0;index<REGISTERS;index++){
    const expected=!push&&index===register&&index!==4?
      width===32?observed:
        (before[index]&0xffff0000)|(observed&0xffff):
      index===4?expectedEsp:before[index];
    if((after[index]>>>0)!==(expected>>>0))
      return refuse('register-result');
  }
  return {...base,formKey:`${base.opcode}:${base.prefixSignature}:o${width}`+
    `:a${base.addressWidth}:-:${base.accessClass}`,reason:null};
}
