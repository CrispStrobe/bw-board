import {createHash} from 'node:crypto';
import {readOrdinaryLinear} from '../i80386-cwsdpmi-at-loaded/passive-ram.mjs';
import {bindLoadedText} from '../i80386-cwsdpmi-at-owned/binding.mjs';

// A single synchronous, runner-owned pre-step cut. This module does not install
// hooks, call the bus, or grant a pause lease to another caller.
const active = new WeakMap();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const setSize = Object.getOwnPropertyDescriptor(Set.prototype,'size').get;
const own = (object, key) => {
  const descriptor = object && Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value'))
    throw new Error(`non-data observation ${String(key)}`);
  return descriptor.value;
};
const optional = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return null;
  if (!Object.hasOwn(descriptor, 'value')) throw new Error(`accessor ${String(key)}`);
  return descriptor.value;
};
const scalar = value => {
  if (value !== null && !['number','string','boolean','undefined'].includes(typeof value))
    throw new Error('nonprimitive observed scalar');
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('nonfinite observed scalar');
  return value ?? null;
};
const ownScalar = (object,key) => scalar(own(object,key));
const optionalScalar = (object,key) => scalar(optional(object,key));
function plain(object, maximum = 64) {
  if (!object || typeof object !== 'object') throw new Error('record object');
  const descriptors = Object.getOwnPropertyDescriptors(object), keys = Reflect.ownKeys(descriptors);
  if (keys.length > maximum || keys.some(key => typeof key !== 'string'))
    throw new Error('record field bound');
  return Object.fromEntries(keys.sort().map(key => {
    const descriptor = descriptors[key], value = descriptor.value;
    if (!Object.hasOwn(descriptor, 'value') ||
        !['number','string','boolean','undefined'].includes(typeof value) && value !== null)
      throw new Error('nonprimitive record field');
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('nonfinite record');
    return [key, value ?? null];
  }));
}
const byteHash = value => {
  if (!ArrayBuffer.isView(value) || value.buffer instanceof SharedArrayBuffer)
    throw new Error('ordinary byte view required');
  return sha(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
};
const cpuFields = ['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
  'cs','ds','es','ss','fs','gs','cr0','cr2','cr3','cr4','cycles','halted','shutdown',
  '_interruptShadow','_nmiShadow','_debugShadow','_nmiActive','_retainedRealCs',
  '_translationGeneration'];
const boardFields = ['cycles','memoryBytes','_a20Configured','_a20Enabled',
  '_fastA20Latch','_mpReady','_lapicTimerNext','_lapicTimerInterval',
  '_lapicTimerPending','_apicIrqMask','_chipDebt','_chipDeadline',
  'displayRevision','_nmiPending','_nmiMasked','_cpuResetPending'];
const requiredBoardFields = new Set(['cycles','_chipDebt','_chipDeadline',
  'displayRevision','_nmiPending','_nmiMasked','_cpuResetPending']);
const cacheFields = ['generation','page','cr3','cr4','physicalBase','userPage',
  'writable','dirty','dirtyAddress','dirtyValue'];

export function candidateAtMain(machine, layout) {
  const cpu = own(machine, 'cpu'), caches = own(cpu, 'segmentCaches');
  const code = own(caches, 1), main = layout?.roles?.main;
  return !!main && Number.isInteger(main.address) && ownScalar(cpu, 'eip') === main.address &&
    !!(ownScalar(cpu, 'cr0') & 1) && !(ownScalar(cpu, 'eflags') & 0x20000) &&
    ownScalar(cpu,'halted') === false && ownScalar(cpu,'shutdown') === false &&
    ownScalar(cpu, '_retainedRealCs') === false && ownScalar(code, 'default32') === true &&
    own(code, 'present') === true && own(code, 'code') === true;
}

function identities(machine) {
  const cpu=own(machine,'cpu'),mem=own(machine,'mem'),page=own(machine,'_page');
  const caches=own(cpu,'segmentCaches'),translations=own(cpu,'_translations');
  const tablePages=own(cpu,'_translationTablePages'),vga=own(machine,'vgaMemory');
  const planes=vga===null?null:own(vga,'planes');
  const latches=vga===null?null:own(vga,'latches');
  const debug=own(cpu,'_debugRegisters');
  return {cpu,mem,memBuffer:mem.buffer,page,pageBuffer:page.buffer,caches,
    cacheValues:[0,1,2,3,4,5].map(n=>own(caches,n)),
    translations,translationValues:Array.from({length:512},(_,n)=>optional(translations,n)),
    tablePages,config:own(machine,'config'),chips:own(machine,'chips'),
    vga,planes,registerSource:vga===null?null:own(vga,'registerSource'),
    planeValues:planes===null?null:[...planes],
    planeBuffers:planes===null?null:planes.map(plane=>plane.buffer),
    latches,latchBuffer:latches?.buffer??null,debug,debugBuffer:debug.buffer};
}
function sameIdentities(before,after) {
  for (const key of ['cpu','mem','memBuffer','page','pageBuffer','caches',
    'translations','tablePages','config','chips','vga','planes','registerSource',
    'latches','latchBuffer','debug','debugBuffer'])
    if (before[key]!==after[key]) return false;
  for (const key of ['cacheValues','translationValues','planeValues','planeBuffers'])
    if (before[key]!==null && (after[key]===null || before[key].length!==after[key].length ||
        before[key].some((value,index)=>value!==after[key][index]))) return false;
  return true;
}

export function observationFingerprint(machine) {
  const cpu = own(machine, 'cpu'), memory = own(machine, 'mem'), page = own(machine, '_page');
  if (memory?.constructor !== Uint8Array || page?.constructor !== Uint8Array ||
      memory.length !== 16 << 20 || page.length !== 4096)
    throw new Error('unexpected AT backing for observation');
  const fields = Object.fromEntries(cpuFields.map(key => [key, ownScalar(cpu, key)]));
  fields._pagingBitWrite = optionalScalar(cpu,'_pagingBitWrite');
  const caches = own(cpu, 'segmentCaches');
  const translations = own(cpu, '_translations');
  if (!Array.isArray(translations) || translations.length !== 512)
    throw new Error('translation-cache shape');
  const entries = Array.from({length:512}, (_, index) => {
    const entry = optional(translations, index);
    if (entry === null || entry === undefined) return null;
    const keys = Object.keys(entry).sort();
    if (keys.join() !== cacheFields.slice().sort().join())
      throw new Error('translation entry shape');
    return Object.fromEntries(cacheFields.map(key => [key, ownScalar(entry, key)]));
  });
  const tablePages = own(cpu, '_translationTablePages');
  if (Object.getPrototypeOf(tablePages) !== Set.prototype || setSize.call(tablePages) > 4096)
    throw new Error('table-page ledger shape');
  const pages = [...Set.prototype.values.call(tablePages)].sort((a,b)=>a-b);
  if (pages.some(n => !Number.isInteger(n) || n < 0 || n >= 4096))
    throw new Error('table-page ledger value');
  const cr3 = own(cpu, 'cr3') >>> 12;
  if (cr3 < 4096 && !pages.includes(cr3)) pages.push(cr3);
  pages.sort((a,b)=>a-b);
  const tableHash = createHash('sha256');
  for (const index of pages) tableHash.update(memory.subarray(index << 12, (index + 1) << 12));
  const board = Object.fromEntries(boardFields.map(key => [key,
    requiredBoardFields.has(key)?ownScalar(machine,key):optionalScalar(machine,key)]));
  const chips = own(machine, 'chips');
  const chipDescriptors=Object.getOwnPropertyDescriptors(chips);
  if (Reflect.ownKeys(chipDescriptors).length > 64 ||
      Object.values(chipDescriptors).some(d=>!Object.hasOwn(d,'value')))
    throw new Error('chip map accessor/bound');
  const chipScalars = Object.fromEntries(Object.entries(chipDescriptors)
    .map(([name,descriptor])=>[name,descriptor.value]).sort(([a],[b]) => a.localeCompare(b))
    .map(([name, chip]) => {
      const descriptors = Object.getOwnPropertyDescriptors(chip);
      if (Reflect.ownKeys(descriptors).length > 256) throw new Error('chip field bound');
      return [name, Object.fromEntries(Object.entries(descriptors)
      .filter(([, descriptor]) => Object.hasOwn(descriptor,'value') &&
        (descriptor.value === null || ['number','string','boolean'].includes(typeof descriptor.value)))
      .map(([key, descriptor]) => [key, scalar(descriptor.value)]).sort(([a],[b]) => a.localeCompare(b)))];
    }));
  const vga = own(machine, 'vgaMemory');
  const vgaHash = vga === null ? null : {
    planes: own(vga,'planes').map(byteHash), latches:byteHash(own(vga,'latches'))};
  const cpuRecord = {fields,gdtr:plain(own(cpu,'gdtr')),idtr:plain(own(cpu,'idtr')),
    ldtr:plain(own(cpu,'ldtr')),tr:plain(own(cpu,'tr')),
    segmentCaches:[0,1,2,3,4,5].map(n => plain(own(caches,n))),
    debug:byteHash(own(cpu,'_debugRegisters')),
    repeatContext:optional(cpu,'_repeatContext'),entries,tablePages:pages};
  if (cpuRecord.repeatContext !== null) throw new Error('repeat context at client entry');
  return {cpuSha256:sha(Buffer.from(JSON.stringify(cpuRecord))),
    boardSha256:sha(Buffer.from(JSON.stringify({board,chipScalars,vgaHash}))),
    ramSha256:byteHash(memory),pageClassSha256:byteHash(page),
    pageTableSha256:tableHash.digest('hex'),tablePageCount:pages.length,
    machineCycles:ownScalar(machine,'cycles'),cpuCycles:ownScalar(cpu,'cycles')};
}

export function bindAtMainCut(machine, layout) {
  const state = active.get(machine) ?? {busy:false,failed:false,completed:false};
  active.set(machine,state);
  if (state.busy || state.failed || state.completed) {
    state.failed=true;
    throw new Error('reentered/failed AT loaded-main cut');
  }
  state.busy=true;
  let before = null, after = null, references = null;
  try {
    if (!candidateAtMain(machine, layout)) throw new Error('not at protected 32-bit main');
    const cpu = own(machine,'cpu'), code = own(own(cpu,'segmentCaches'),1);
    const base = own(code,'base'), address = layout.text.address;
    if (!Number.isInteger(base) || !Number.isInteger(address) ||
        base < 0 || base + address + layout.text.bytes > 0x100000000)
      throw new Error('loaded text linear span');
    const linear = base + address;
    references=identities(machine);
    before = observationFingerprint(machine);
    let copy = null, binding = null, failed = null;
    try {
      copy = readOrdinaryLinear(machine,{sourcePaused:true,linear,length:layout.text.bytes});
      binding = bindLoadedText(layout,cpu,at => {
        if (at < linear || at >= linear + copy.length) throw new Error('snapshot reader extent');
        return copy[at - linear];
      });
    } catch(error) { failed = error; }
    after = observationFingerprint(machine);
    if (state.failed || !sameIdentities(references,identities(machine)) ||
        JSON.stringify(before) !== JSON.stringify(after))
      throw new Error('loaded-code observation mutated CPU/board/RAM');
    if (failed) throw failed;
    state.completed=true;
    return {binding,loadedBytes:copy.length,loadedSha256:sha(copy),before,after};
  } catch(error) {
    state.failed=true;
    if (before) error.observation = {before,after};
    throw error;
  } finally {state.busy=false;}
}
