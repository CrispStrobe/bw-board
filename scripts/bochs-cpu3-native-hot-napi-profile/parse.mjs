/** Diagnostic times only; this parser never establishes native/guest qualification. */
import {profileBuckets} from './napi.mjs';
const max=(1n<<64n)-1n;
const fail=m=>{throw Error('hot NAPI profile: '+m);};
const check=(v,m)=>{if(!v)fail(m);};
const uint=s=>{check(typeof s==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(s),'canonical uint64');const n=BigInt(s);check(n<=max,'uint64 overflow');return n;};
const sum=values=>values.reduce((a,b)=>a+b,0n);
export function parseHotNapiProfile(lines,{expectedCounts}={}){
 let header=false,control=null;const buckets={};let rows=0;
 for(const line of lines){if(!line.startsWith('BWNP1\t'))continue;check(++rows<=17,'record bound');const p=line.replace(/\n$/,'').split('\t');check(!p.some(v=>v.includes('\r')),'canonical newline');
  if(p[1]==='HEADER'){check(!header&&rows===1&&p.join('\t')==='BWNP1\tHEADER\t1\tnanoseconds\tresume-only','version/header');header=true;}
  else if(p[1]==='CONTROL'){check(header&&!control&&rows===2&&p.length===10,'control shape/order');const names=['successfulResumes','callbackCalls','maxCallbackDepth','nestedCallbacks','clockReads','liveCallbackDepth','overflow','clockRegression'];control=Object.fromEntries(names.map((name,i)=>[name,uint(p[i+2])]));}
  else if(p[1]==='BUCKET'){check(header&&control&&p.length===6,'bucket shape/order');check(p[2]===profileBuckets[rows-3]&&!Object.hasOwn(buckets,p[2]),'exact unique bucket');buckets[p[2]]={count:uint(p[3]),totalNs:uint(p[4]),maxNs:uint(p[5])};}
  else fail('unknown record');
 }
 check(header&&control&&rows===17&&Object.keys(buckets).length===profileBuckets.length,'complete profile');
 check(control.overflow===0n&&control.clockRegression===0n&&control.liveCallbackDepth===0n,'overflow/live callback');
 for(const value of Object.values(buckets))check(value.maxNs<=value.totalNs&&(value.count!==0n||value.totalNs===0n&&value.maxNs===0n),'bucket count/time domain');
 const b=name=>buckets[name];
 check(b('native_resume_inclusive').count===control.successfulResumes&&b('resume_return_conversion').count===control.successfulResumes&&control.successfulResumes>0n,'successful resume/snapshot counts');
 const operations=['scalar_native_tick','scalar_quantum','scalar_pio','scalar_ack'];
 check(sum(operations.map(name=>b(name).count))===b('scalar_whole').count&&sum(operations.map(name=>b(name).totalNs))===b('scalar_whole').totalNs,'exact scalar operation partition');
 const phases=['scalar_arguments_scopes','scalar_op_call','scalar_return_validation','scalar_mapping_call','scalar_mapping_fields','scalar_scope_close'];
 check(sum(phases.map(name=>b(name).totalNs))===b('scalar_whole').totalNs,'exact scalar time partition');
 for(const name of ['scalar_arguments_scopes','scalar_op_call','scalar_return_validation','scalar_mapping_fields','scalar_scope_close'])check(b(name).count===b('scalar_whole').count,'scalar phase counts');
 check(b('scalar_mapping_call').count===b('scalar_whole').count-b('scalar_pio').count,'mapping calls exclude PIO');
 check(control.callbackCalls===b('scalar_whole').count+b('memory_whole').count+b('page_whole').count,'whole callback census');
 check(control.clockReads===4n*control.successfulResumes+7n*b('scalar_whole').count-b('scalar_pio').count+2n*(b('memory_whole').count+b('page_whole').count),'exact successful clock read census');
 if(expectedCounts){for(const [name,count] of Object.entries(expectedCounts)){check(Object.hasOwn(buckets,name),'expected bucket known');check(b(name).count===BigInt(count),'actual expected '+name+' count');}}
 const callbackNs=sum(['scalar_whole','memory_whole','page_whole'].map(name=>b(name).totalNs));
 const nonNested=control.maxCallbackDepth===1n&&control.nestedCallbacks===0n;
 check(!nonNested||callbackNs<=b('native_resume_inclusive').totalNs,'non-nested callback containment');
 return {schema:'bw.hot-napi-cost-diagnostic.v1',qualification:false,control,buckets,residualResumeNs:nonNested?b('native_resume_inclusive').totalNs-callbackNs:null,residualScope:'includes native execution, other bridge/profiler bookkeeping and unclassified work; not pure Bochs'};
}
