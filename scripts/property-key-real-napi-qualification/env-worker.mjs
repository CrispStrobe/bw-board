import {parentPort,workerData} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {authenticatedFixturePath} from './auth.mjs';
if(!['owner','foreign','fresh'].includes(workerData))throw Error('fixed worker role required');
const api=createRequire(import.meta.url)(authenticatedFixturePath());
if(workerData==='foreign'){
 let denied=false;try{api.prepare();}catch(e){denied=/env\/thread\/reentry refused/.test(e.message);}
 if(!denied)throw Error('foreign env was not denied');parentPort.postMessage('foreign-denied');parentPort.close();
}else{
 api.prepare();if(api.readBytes({bytes:41})!==41)throw Error('owner key read');
 if(workerData==='fresh'){api.release();parentPort.postMessage('fresh-released');parentPort.close();}
 else{parentPort.postMessage('owner-prepared');parentPort.once('message',command=>{
  if(command==='release'){api.release();parentPort.postMessage('owner-released');}
  else if(command!=='teardown')throw Error('fixed owner command required');
  parentPort.close(); // teardown relies on exact helper hook
 });}
}
