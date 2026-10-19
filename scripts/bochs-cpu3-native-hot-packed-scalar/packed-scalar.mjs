/** Opt-in host protocol, not a new guest/device capability. */
const propertyGet=Reflect.get,functionApply=Reflect.apply,defineProperty=Object.defineProperty,OwnedTuple=Uint32Array,BoxObject=Object,ValidationError=TypeError,ProtocolError=Error;
function getProperty(value,key){if(value===null||value===undefined)throw new ValidationError('packed scalar property receiver rejected');return propertyGet(BoxObject(value),key);}
export function scalarU32(value){if(typeof value!=='number'||!(value>=0&&value<=0xffffffff)||value%1!==0)throw new ValidationError('packed scalar requires finite integer uint32');return value;}
export function installPackedScalar(board){
 if((typeof board!=='object'&&typeof board!=='function')||board===null)throw new ValidationError('packed scalar board required');
 if('packedScalar' in board)throw new ProtocolError('packed scalar property collision');
 const tuple=new OwnedTuple(3);let active=false;
 function packedScalar(op,a,b,c){
  if(this!==board)throw new ProtocolError('packed scalar receiver rejected');
  if(active)throw new ProtocolError('packed scalar reentry rejected');
  if(typeof op!=='number'||!(op>=1&&op<=4)||op%1!==0)throw new ProtocolError('packed scalar operation rejected');
  active=true;
  try{
   const name=op===1?'nativeTick':op===2?'quantum':op===3?'outPort':'acknowledgeIrq';
   const args=op===3?[a,b,c]:op===2?[a]:[];
   const result=functionApply(getProperty(board,name),board,args);
   const value=scalarU32(op===3?getProperty(result,'value'):result);
   const mapping=op===3?result:functionApply(getProperty(board,'mappingState'),board,[]);
   const epoch=scalarU32(getProperty(mapping,'mappingEpoch'));
   const a20=scalarU32(getProperty(mapping,'boardA20'));
   tuple[0]=value;tuple[1]=epoch;tuple[2]=a20;return tuple;
  }finally{active=false;}
 }
 defineProperty(board,'packedScalar',{value:packedScalar,writable:false,configurable:false,enumerable:false});
 return board;
}
