import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {createCompiledDeviceScheduler} from '../src/experimental/compiled-device-scheduler.js';
import {Harris8254Adapter} from '../src/experimental/harris-8254-adapter.js';
import {HarrisFDCAdapter} from '../src/experimental/harris-fdc-adapter.js';
import {HarrisKeyboardAdapter} from '../src/experimental/harris-keyboard-adapter.js';

function fixture() {
    const inputs=['reset','enable','data'];
    const circuit=new CompiledDigitalCircuit({enabled:true,parts:[{id:'source',pins:inputs,outputs:inputs},
        {id:'device',pins:[...inputs,'out'],outputs:['out']}],wires:inputs.map(pin=>({from:'source',fromTerminal:pin,to:'device',toTerminal:pin}))});
    let calls=0;
    const device={eventRevision:0,invert:0,update(read){calls++;if(read('reset'))return {out:0};return {out:(read('enable')?read('data'):0)^this.invert};}};
    device.eventDrivenUpdate=device.update;
    const scheduler=createCompiledDeviceScheduler(device,circuit.bind('device'));
    const update=values=>{circuit.drive('source',values);circuit.settle();scheduler.update();circuit.settle();};
    update({reset:0,enable:0,data:0});return {circuit,device,scheduler,update,calls:()=>calls};
}
test('device scheduler tracks actual reads, changes dependencies, and honors explicit external revisions',()=>{
    const f=fixture();assert.equal(f.calls(),1);
    f.update({data:1});f.update({});assert.equal(f.calls(),1);
    f.update({enable:1});assert.equal(f.calls(),2);assert.equal(f.circuit.read('device','out'),1);
    f.update({data:0});assert.equal(f.calls(),3);assert.equal(f.circuit.read('device','out'),0);
    f.update({enable:0});assert.equal(f.calls(),4);f.update({data:1});assert.equal(f.calls(),4);
    f.device.invert=1;f.device.eventRevision++;f.update({});assert.equal(f.calls(),5);assert.equal(f.circuit.read('device','out'),1);
    f.scheduler.invalidate();f.update({});assert.equal(f.calls(),6);
});
test('custom replacement restores ordinary updates and faults are not cached as successes',()=>{
    const f=fixture(),original=f.device.update;
    f.device.update=function(read){return original.call(this,read);};
    f.update({});f.update({});assert.equal(f.calls(),3);
    f.device.update=original;f.update({});assert.equal(f.calls(),4);f.update({});assert.equal(f.calls(),4);
    assert.throws(()=>f.update({enable:1,data:'Z'}),{code:'FLOATING'});
    f.update({data:1});assert.equal(f.circuit.read('device','out'),1);
});
test('dependency tracker rejects reentrant evaluation without losing invalidation',()=>{
    const f=fixture(),tracker=f.circuit.bind('device').tracker();
    assert.throws(()=>tracker.invoke(()=>tracker.invoke(()=>0)),/reentrant/);
    assert.equal(tracker.changed(),true);
    assert.equal(tracker.invoke(read=>read('enable')),0);assert.equal(tracker.changed(),false);
});

test('owned adapters invalidate public external actions; unknown subclasses do not inherit opt-in',()=>{
    for(const Adapter of [Harris8254Adapter,HarrisFDCAdapter,HarrisKeyboardAdapter]) {
        const device=new Adapter({enabled:true,transferEnabled:true});
        assert.equal(device.eventDrivenUpdate,device.update);
        const revision=device.eventRevision;device.reset();assert.ok(device.eventRevision>revision);
        class Custom extends Adapter {}
        assert.equal(new Custom({enabled:true}).eventDrivenUpdate,undefined);
    }
    const keyboard=new HarrisKeyboardAdapter({enabled:true}),keyRevision=keyboard.eventRevision;
    keyboard.press(0x1c);assert.ok(keyboard.eventRevision>keyRevision);
    const fdc=new HarrisFDCAdapter({enabled:true,transferEnabled:true}),mediaRevision=fdc.eventRevision;
    fdc.loadMedia(new Uint8Array(512),{cylinders:1,heads:1,sectors:1,bytesPerSector:512});assert.ok(fdc.eventRevision>mediaRevision);
});
