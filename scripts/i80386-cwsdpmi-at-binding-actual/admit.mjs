// Hosted fresh-compile parser admission. No guest memory or CPU observation.
import {createHash} from 'node:crypto';
import {lstatSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {admitBoundImage} from '../i80386-cwsdpmi-at-owned/binding.mjs';

const sha = raw => createHash('sha256').update(raw).digest('hex');
const save = (root, name, value) => writeFileSync(`${root}/${name}`,
  JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
const limits = {executable:2<<20, map:1<<20, auditMap:1<<20, report:1<<20};

function ordinary(path, role) {
  const st=lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink()||st.size>limits[role])
    throw new Error(`nonordinary or unbounded ${role}`);
  const bytes=readFileSync(path);
  if(bytes.length!==st.size)throw new Error(`${role} changed size`);
  return bytes;
}

export function formatObservation(exe) {
  const raw={mzHeaderHex:exe.subarray(0,Math.min(28,exe.length)).toString('hex')};
  if(exe.length<28)return raw;
  const last=exe.readUInt16LE(2),blocks=exe.readUInt16LE(4);
  const coff=blocks*512-(last?512-last:0);
  raw.coffOffset=coff;
  if(last>511||coff<28||coff+20>exe.length)return raw;
  raw.coffHeaderHex=exe.subarray(coff,coff+20).toString('hex');
  const count=exe.readUInt16LE(coff+2),optional=exe.readUInt16LE(coff+16);
  raw.sectionCount=count;raw.optionalHeaderBytes=optional;
  if(count>96||optional>256||coff+20+optional+count*40>exe.length)return raw;
  raw.optionalHeaderHex=exe.subarray(coff+20,coff+20+optional).toString('hex');
  raw.sectionTableHex=exe.subarray(coff+20+optional,
    coff+20+optional+count*40).toString('hex');
  return raw;
}

export function admit(exePath,mapPath,auditMapPath,reportPath,out) {
  mkdirSync(out,{recursive:false});
  const observations={schema:'bw.cwsdpmi-owned.at-binding-inputs.v1',roles:{}};
  const paths={executable:exePath,map:mapPath,auditMap:auditMapPath,report:reportPath};
  const raw={};
  for(const [role,path] of Object.entries(paths)) {
    raw[role]=ordinary(path,role);
    observations.roles[role]={bytes:raw[role].length,sha256:sha(raw[role])};
    save(out,`observed-${role}.json`,observations.roles[role]);
  }
  save(out,'inputs.json',observations);
  save(out,'format.json',formatObservation(raw.executable));
  if(!raw.map.equals(raw.auditMap))throw new Error('private map differs from retained audit map');
  const compile=JSON.parse(raw.report.toString('utf8'));
  const layout=admitBoundImage(raw.executable,raw.map,compile);
  const result={schema:'bw.cwsdpmi-owned.at-binding-actual.v1',
    admission:'FRESH_COMPILE_FORMAT_AND_MAP_ONLY',
    executableSha256:layout.executableSha256,mapSha256:layout.mapSha256,
    linkedText:{address:layout.text.address,bytes:layout.text.bytes,sha256:layout.text.sha256},
    roles:Object.fromEntries(Object.entries(layout.roles).map(([name,role])=>
      [name,{address:role.address,bytes:role.bytes,member:role.member}])),
    limits:['No guest or loaded-code observation','No INT2F/INT31/IRET service proof',
      'No binary, object, toolchain or media uploaded']};
  save(out,'admission.json',result);
  return result;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [exe,map,auditMap,report,out]=process.argv.slice(2);
  if(!exe||!map||!auditMap||!report||!out)throw new Error('usage: admit.mjs exe map audit-map report out');
  try {admit(exe,map,auditMap,report,out);}
  catch(error) {
    try {save(out,'failure.json',{phase:'format-or-map-admission',
      errorType:error?.constructor?.name??'Unknown',message:String(error?.message??'unknown')});}
    catch { /* Preserve the original refusal. */ }
    process.stderr.write(`AT_BINDING_ADMISSION_FAIL ${String(error?.message??'unknown')}\n`);
    process.exitCode=1;
  }
}
