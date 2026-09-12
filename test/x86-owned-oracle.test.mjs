import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {OWNED_ORACLE_PROBES} from '../scripts/lib/x86-owned-oracle-probes.mjs';
import {localProbe} from '../scripts/lib/x86-oracle-local.mjs';
const probe=name=>OWNED_ORACLE_PROBES.find(p=>p.name===name);
for(const model of ['8086','80186','80286']) {
    test(`${model} architectural oracle adapter executes one owned instruction`,()=>{
        const mov=localProbe(model,probe('mov-word'));assert.equal(mov.registers.ax,0x1234);assert.equal(mov.registers.ip,0x103);
        const loop=localProbe(model,probe('loop-taken'));assert.equal(loop.registers.cx,1);assert.equal(loop.registers.ip,0x100);
        const xchg=localProbe(model,probe('memory-xchg'));assert.equal(xchg.registers.ax,0xabcd);
        assert.equal(xchg.memory[0x2001],0x34);assert.equal(xchg.memory[0x2002],0x12);
        const add=localProbe(model,probe('add-overflow'));assert.equal(add.registers.ax,0x8000);
        assert.equal(add.registers.flags&0x881,0x880);
        for(const [name,expected] of [
            ['multiply-unsigned-word',{ax:0,dx:1}],['multiply-signed-word',{ax:0xffeb,dx:0xffff}],
            ['divide-unsigned-word',{ax:4386,dx:3}],['divide-signed-word',{ax:0xfffb,dx:0xfffe}],
            ['load-es-pointer',{ax:0x5678,es:0x1234}],['load-ds-pointer',{ax:0xabcd,ds:0x3412}],
            ['lea-does-not-read-memory',{ax:0x2001}],['shift-arithmetic-right-one',{ax:0xc000}],
            ['cbw-negative',{ax:0xff80}],['cwd-negative',{dx:0xffff}],
        ]) {
            const result=localProbe(model,probe(name));
            for(const [reg,value] of Object.entries(expected))assert.equal(result.registers[reg],value,`${name}/${reg}`);
        }
        const store=localProbe(model,probe('store-word-backward'));assert.equal(store.registers.di,0x2fff);
        assert.equal(store.memory[0x3001],0xef);assert.equal(store.memory[0x3002],0xbe);
    });
}
test('owned probes declare models and undefined flags explicitly',()=>{
    assert.equal(new Set(OWNED_ORACLE_PROBES.map(p=>p.name)).size,OWNED_ORACLE_PROBES.length);
    for(const p of OWNED_ORACLE_PROBES)if(p.flagsMask!==0xfd5)assert.ok(p.maskReason);
    assert.throws(()=>localProbe('8086',probe('pusha')),/unsupported/);
});
test('external adapter refuses absent or wrong provenance instead of an empty pass',()=>{
    const script=new URL('../scripts/compare-pcjs-owned.mjs',import.meta.url).pathname;
    const missing=spawnSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,PCJS_ROOT:''}});
    assert.notEqual(missing.status,0);assert.match(missing.stderr,/Set PCJS_ROOT/);assert.equal(missing.stdout,'');
    const wrong=spawnSync(process.execPath,[script],{encoding:'utf8',env:{...process.env,PCJS_ROOT:new URL('..',import.meta.url).pathname}});
    assert.notEqual(wrong.status,0);assert.match(wrong.stderr,/exact clean oracle pin/);assert.equal(wrong.stdout,'');
});
