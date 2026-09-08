import {test} from 'node:test';
import assert from 'node:assert/strict';
import {I8086Machine} from '../src/i8086-machine.js';

function fixture(reference) {
    const machine = new I8086Machine({clockHz:5000000, regions:[], chips:[
        {kind:'pit',name:'pit',at:0x40}, {kind:'cga',name:'cga',at:0x3d0}
    ]});
    const pit=machine.chips.pit, cga=machine.chips.cga, trace=[];
    if (reference) {
        machine._buildAdvanceList=function() {
            const list=[];let anyMs=false;
            for(const chip of Object.values(this.chips)) {
                if(chip.advanceMs){list.push(chip,1);anyMs=true;}
                else if(chip.advance)list.push(chip,0);
            }
            for(const device of Object.values(this.devices||{}))if(device.advance)list.push(device,0);
            this._advList=list;this._anyMs=anyMs;return list;
        };
        pit.advanceMs=function(ms) {
            const exact=ms*this.clockHz/1000+this._frac, whole=Math.floor(exact);
            this._frac=exact-whole;
            if(whole>0) for(const c of this.counters) c.advance(whole);
        };
        cga._framePos=function(cycles) { return cycles%this._frame; };
        machine._advanceChips=function(n) {
            const list=this._advList!==null?this._advList:this._buildAdvanceList();
            if(!list.length)return;
            const ms=this._anyMs?n*1000/this.clockHz:0;
            for(let i=0;i<list.length;i+=2) {
                if(list[i+1]===1)list[i].advanceMs(ms);else list[i].advance(n);
            }
        };
    }
    const snapshot=()=>({cycles:machine.cycles, pit:pit.getState(),frac:pit._frac,
        cga:cga.getState()});
    const advanceMs=pit.advanceMs;
    let edges=0;
    pit.hooks.onOutput=(channel,level)=>{
        trace.push({phase:'pit',channel,level,state:snapshot()});
        if(channel===0 && ++edges===2) machine.attachDevice('late',{advance(n){trace.push({phase:'late',n,state:snapshot()});}});
        if(channel===0 && edges%17===0) pit.counters[1].setGate(1-pit.counters[1].gate);
    };
    cga.hooks.onVSync=()=>{
        trace.push({phase:'vsync',state:snapshot()});
        cga.write(4,6);cga.write(5,22+(edges%3));
    };
    for(let ch=0;ch<3;ch++) {
        pit.write(3,ch<<6|0x36);pit.write(ch,44+ch*11);pit.write(ch,1);
    }
    machine.attachDevice('observer',{advance(n){trace.push({phase:'observer',n,state:snapshot()});}});
    trace.length=0;
    return {machine,pit,cga,trace,snapshot,advanceMs};
}

test('every instruction publishes exact device state, ordered callbacks and attachment changes',()=>{
    const a=fixture(false),b=fixture(true), costs=[4,8,12,16,25,10,17,3,1000];
    for(let i=0;i<2000;i++) {
        for(const f of [a,b]) {
            if(i===700) f.pit.advanceMs=function(ms) {
                f.trace.push({phase:'override',ms});
                return f.advanceMs.call(this,ms);
            };
            if(i===900) f.pit.advanceMs=f.advanceMs;
            if(i%113===0) {f.pit.write(3,0);f.pit.read(0);}
            if(i%257===0) f.machine.clockHz = i%514===0 ? 5000000 : 4772727;
            const n=costs[i%costs.length];f.machine.cycles+=n;f.machine._advanceChips(n);
        }
        assert.deepEqual(a.snapshot(),b.snapshot(),`state at instruction ${i}`);
        assert.deepEqual(a.trace,b.trace,`observations at instruction ${i}`);
        a.trace.length=b.trace.length=0;
    }
    assert.ok(a.machine.devices.late,'callback attachment must execute');
    assert.ok(a.cga._frameCount>0,'must reach actual vsync callbacks');
});

test('an output-edge deadline alone does not authorize deferring public counter state',()=>{
    const a=fixture(false),b=fixture(false);
    const n=12;
    assert.ok(a.pit.nextWakeMs()>n*1000/a.machine.clockHz);
    a.machine.cycles+=n;a.machine._advanceChips(n);
    b.machine.cycles+=n; // unsafe scheduler defers because no OUT edge is due
    assert.notEqual(a.pit.counters[0].ce,b.pit.counters[0].ce);
    assert.notEqual(a.pit._frac,b.pit._frac);
});
