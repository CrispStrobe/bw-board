import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const c=JSON.parse(readFileSync(new URL('./contract.json',import.meta.url),'utf8'));
if(c.status!=='ROOT_REVIEWED_REAL_NAPI_FIXTURE_READY'||!c.addonSha256)throw Error('PENDING worker fixture authority');
if(!['owner','foreign','fresh'].includes(workerData))throw Error('fixed worker role required');
const path=new URL(c.addonPath,import.meta.url);
if(createHash('sha256').update(readFileSync(path)).digest('hex')!==c.addonSha256)throw Error('fixed worker addon hash');
const api=createRequire(import.meta.url)(path.pathname);
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
