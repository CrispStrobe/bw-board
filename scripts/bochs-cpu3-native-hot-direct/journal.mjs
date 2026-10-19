import {writeSync} from 'node:fs';
/** Complete bounded record writes; zero progress cannot silently truncate evidence. */
export function writeJournalRecord(fd,bytes,{write=writeSync}={}){
 const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);let offset=0;
 while(offset<buffer.length){const count=write(fd,buffer,offset,buffer.length-offset);if(!Number.isSafeInteger(count)||count<=0||count>buffer.length-offset)throw Error('compact journal write made invalid progress');offset+=count;}
 return offset;
}
