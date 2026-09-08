import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {REGISTERS,parseSST286,parseRevocations,executeSST286} from '../scripts/lib/sst286.mjs';

const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const chunk=(tag,b)=>Buffer.concat([Buffer.from(tag),u32(b.length),b]);
const counted=b=>Buffer.concat([u32(b.length),b]);
function registers(values) {
    const names=REGISTERS.filter(r=>r in values),b=Buffer.alloc(2+names.length*2);
    b.writeUInt16LE(names.reduce((mask,r)=>mask|(1<<REGISTERS.indexOf(r)),0));
    names.forEach((r,i)=>b.writeUInt16LE(values[r],2+i*2));return b;
}
function vector(bytes=[0xb8,0x34,0x12,0xf4]) {
    const initial=Object.fromEntries(REGISTERS.map(r=>[r,0]));initial.ip=0x100;initial.flags=2;
    return {bytes,hash:'1'.repeat(40),initial:{regs:initial,ram:bytes.map((v,i)=>[0x100+i,v])},
        final:{regs:{ax:0x1234,ip:0x104},ram:[],masks:{}},exception:null};
}
function encode(t=vector(),extra=[]) {
    const ram=values=>Buffer.concat([u32(values.length),...values.map(([a,v])=>Buffer.concat([u32(a),Buffer.from([v])]))]);
    const state=s=>Buffer.concat([chunk('REGS',registers(s.regs)),chunk('RAM ',ram(s.ram)),chunk('RMSK',registers(s.masks??{}))]);
    const header=Buffer.alloc(12);header[0]=1;header[1]=1;header.writeUInt32LE(1,4);header.write('C286',8);
    const meta=Buffer.alloc(31);meta.writeUInt32LE(25000,15);
    return Buffer.concat([chunk('MOO ',header),chunk('META',meta),chunk('RMSK',registers({flags:0xffef})),
        chunk('TEST',Buffer.concat([u32(0),chunk('NAME',counted(Buffer.from('owned MOV'))),chunk('BYTS',counted(Buffer.from(t.bytes))),
            chunk('INIT',state(t.initial)),chunk('FINA',state(t.final)),chunk('CYCL',Buffer.concat([u32(1),Buffer.alloc(15)])),
            chunk('GMET',Buffer.alloc(10)),chunk('HASH',Buffer.alloc(20,1)),...extra]))]);
}
test('MOO 1.1 decodes masks, sparse state, hashes and generator counts independently',()=>{
    const parsed=parseSST286(encode());assert.equal(parsed.tests.length,1);
    assert.equal(parsed.generatorCount,25000);assert.equal(parsed.masks.flags,0xffef);
    assert.equal(parsed.tests[0].hash,'01'.repeat(20));assert.equal(parsed.tests[0].cycles,1);
    assert.equal(executeSST286(parsed.tests[0],parsed.masks).status,'pass');
});
test('MOO rejects every truncated prefix, duplicate and unknown semantic chunks',()=>{
    const b=encode();for(let n=0;n<b.length;n++) assert.throws(()=>parseSST286(b.subarray(0,n)),undefined,`length ${n}`);
    assert.throws(()=>parseSST286(encode(vector(),[chunk('HASH',Buffer.alloc(20))])),/duplicate/);
    assert.throws(()=>parseSST286(encode(vector(),[chunk('RG32',Buffer.alloc(4))])),/unsupported/);
});
test('exception records survive parsing and invalid CPU, mode or declared counts refuse',()=>{
    const payload=Buffer.concat([Buffer.from([13]),u32(0x123456)]);
    const parsed=parseSST286(encode(vector(),[chunk('EXCP',payload)]));
    assert.deepEqual(parsed.tests[0].exception,{number:13,flagAddress:0x123456});
    assert.equal(executeSST286(parsed.tests[0]).executed,true);
    assert.equal(executeSST286(parsed.tests[0]).status,'fail','MOV must not manufacture the exception claimed by metadata');
    const cpu=encode();cpu.write('8086',16);assert.throws(()=>parseSST286(cpu),/C286/);
    const mode=encode();mode[28+27]=1;assert.throws(()=>parseSST286(mode),/mode\/count/);
    const count=encode();count.writeUInt32LE(2,12);assert.throws(()=>parseSST286(count),/mode\/count/);
});
test('CLI missing corpus and invalid selections/limits fail instead of reporting empty success',()=>{
    const cli=new URL('../scripts/grind-i80286.mjs',import.meta.url);
    for(const [args,root,pattern] of [[[], '', /Set I80286_VECTORS/], [['--limit','0'],'/unused',/invalid --limit/],
        [['--limit','NaN'],'/unused',/invalid --limit/], [['not-an-opcode'],'/unused',/unknown argument/]]) {
        const r=spawnSync(process.execPath,[cli.pathname,...args],{encoding:'utf8',env:{...process.env,I80286_VECTORS:root}});
        assert.equal(r.status,2);assert.match(r.stderr,pattern);assert.equal(r.stdout,'');
    }
});
test('revocation syntax is strict and exact hashes are retained',()=>{
    const hash='ab'.repeat(20);assert.deepEqual([...parseRevocations(`# comment\r\n${hash}\n\n`)],[hash]);
    assert.throws(()=>parseRevocations('not-a-hash'),/invalid revocation/);
});
test('executes actual MOV, includes sequential HALT, and detects mutated expected registers',()=>{
    const t=vector();assert.equal(executeSST286(t).status,'pass');
    t.final.regs.ax=0xabcd;const result=executeSST286(t);assert.equal(result.status,'fail');
    assert.equal(result.diffs[0].actual,0x1234);
});
test('taken self-jump injects HALT at new fetch without overwriting memory',()=>{
    const t=vector([0xeb,0xfe,0xf4]);t.final.regs={ip:0x101};
    assert.equal(executeSST286(t).status,'pass');
});
test('HALT terminates itself, a missing sequential HALT is not silently injected',()=>{
    const t=vector([0xf4]);t.final.regs={ip:0x101};assert.equal(executeSST286(t).status,'pass');
    const bad=vector();bad.initial.ram[3][1]=0x90;
    assert.equal(executeSST286(bad).reason,'terminator-not-halt');
});
test('sparse final memory merges with initial and unexpected writes fail',()=>{
    const t=vector([0xa3,0x00,0x02,0xf4]);t.initial.regs.ax=0xbeef;t.initial.regs.ds=0xffff;
    t.final.regs={ip:0x104};t.final.ram=[[0x1001f0,0xef],[0x1001f1,0xbe]];
    assert.equal(executeSST286(t).status,'pass','address above 1 MiB is not wrapped');
    t.final.ram=[];assert.equal(executeSST286(t).status,'fail','unreported writes must not disappear');
    assert.equal(executeSST286(vector()).status,'pass','next case has fresh memory');
});
test('register masks apply, but defined-bit mismatches remain failures',()=>{
    const t=vector();t.final.regs.flags=0x12;
    assert.equal(executeSST286(t,{flags:0xffef}).status,'pass');
    assert.equal(executeSST286(t).status,'fail');
    t.final.masks.flags=0xffff;assert.equal(executeSST286(t,{flags:0xffef}).status,'fail');
});
test('false exception expectations, unsupported opcodes and exhausted budgets never count as passes',()=>{
    const t=vector();t.exception={number:13,flagAddress:0};
    assert.equal(executeSST286(t).status,'fail');
    t.exception=null;t.bytes[0]=0x0f;t.initial.ram[0][1]=0x0f;
    assert.equal(executeSST286(t).status,'unsupported');
    assert.equal(executeSST286(vector(),{},{maxTransfers:1}).status,'budget');
    assert.throws(()=>executeSST286(vector(),{},{maxTransfers:NaN}),/budget/);
});
