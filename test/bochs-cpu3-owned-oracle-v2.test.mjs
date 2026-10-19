import assert from 'node:assert/strict';
import test from 'node:test';
import {parseBochsCpu3OwnedOracleV2} from '../scripts/bochs-cpu3-owned-oracle-v2/parse.mjs';
import {patchPinnedHeader} from '../scripts/bochs-cpu3-owned-oracle-v2/patch.mjs';

const h=value=>value.toString(16);
function validRecord(){
  const lines=['BW386O2\tBEGIN\tpaging-v2\tBHPG004'];
  const events=[];
  const add=(instruction,kind,a,b,c,d,e,why=0,phase='none',bytes='-')=>{
    events.push(`BW386O2\tEVENT\t${events.length+1}\t${instruction}\t${kind}\t${[a,b,c,d,e,why].map(h).join('\t')}\t${phase}\t${bytes}`);
  };
  add(1,'instruction',0,0x7e00,0,0,0);
  add(1,'physical-access',0x9000,0,4,0,0,6,'postread','03a00000');
  add(1,'physical-access',0x9000,0,4,0,1,6,'postwrite','23a00000');
  add(1,'physical-access',0xa014,0,4,0,0,5,'postread','03500000');
  add(1,'physical-access',0xa014,0,4,0,1,5,'postwrite','63500000');
  add(1,'linear-access',0x5000,0x5000,4,0,1,0,'prewrite','44332211');
  add(2,'instruction',8,0x7e80,0,0,0);
  add(2,'linear-access',0x5000,0x5000,4,0,0,0,'postread','44332211');
  for(const char of 'BHPG004') add(2,'port-write',0xe9,char.charCodeAt(0),1,0,0);
  lines.push(...events);
  lines.push(`BW386O2\tSTATE\t${[0,0,0,0,0,0,0,0,0,0,0x80000001,0,0x9000].map(h).join('\t')}`);
  lines.push(`BW386O2\tDEBUG\t${Array(6).fill('0').join('\t')}`);
  lines.push(`BW386O2\tTABLE\t${Array(4).fill('0').join('\t')}`);
  lines.push('BW386O2\tSCHED\t0\t0\t0');
  for(const name of ['es','cs','ss','ds','fs','gs','ldtr','tr'])
    lines.push(`BW386O2\tSEG\t${name}\t${[name==='cs'?'8':'0',...Array(9).fill('0')].join('\t')}`);
  lines.push('BW386O2\tRAM\tpde0\t9000\t23a00000');
  lines.push('BW386O2\tRAM\tpte5\ta014\t63500000');
  lines.push('BW386O2\tRAM\tdata5\t5000\t44332211');
  lines.push(`BW386O2\tEND\tBHPG004\t2\t${events.length}`);
  return lines.join('\n')+'\n';
}

test('accepts direct hook bytes and separately labelled RAM snapshots',()=>{
  const parsed=parseBochsCpu3OwnedOracleV2(validRecord());
  assert.equal(parsed.ramSnapshots.pte5.bytes,'63500000');
  assert.equal(parsed.events.find(e=>e.kind==='physical-access').why,6);
});
test('rejects malformed, substituted and missing hook byte evidence',()=>{
  const source=validRecord();
  for(const broken of [
    source.replace('03a00000','deadbeef'),
    source.replace('63500000','6350000'),
    source.replace('44332211','44332210'),
    source.replace('a014\t0\t4\t0\t1\t5','a014\t0\t4\t0\t1\t6'),
  ]) assert.throws(()=>parseBochsCpu3OwnedOracleV2(broken));
});
test('rejects unsupported rw, false instruction index and false end index',()=>{
  const source=validRecord();
  for(const broken of [
    source.replace('9000\t0\t4\t0\t0\t6','9000\t0\t4\t0\t2\t6'),
    source.replace('2\tlinear-access\t5000','3\tlinear-access\t5000'),
    source.replace('END\tBHPG004\t2\t','END\tBHPG004\t3\t'),
  ]) assert.throws(()=>parseBochsCpu3OwnedOracleV2(broken));
});
test('patch bridge refuses unpinned or unlisted upstream bytes',()=>{
  assert.throws(()=>patchPinnedHeader('bochs/cpu/cpu.h',Buffer.from('wrong')));
  assert.throws(()=>patchPinnedHeader('bochs/other.h',Buffer.from('wrong')));
});
