import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Harris80C286Bus} from '../src/experimental/harris-80c286-bus.js';
import {HarrisDMAAdapter} from '../src/experimental/harris-dma-adapter.js';
import {HarrisFDCAdapter} from '../src/experimental/harris-fdc-adapter.js';
import {HarrisKeyboardAdapter} from '../src/experimental/harris-keyboard-adapter.js';
import {Harris8259Adapter} from '../src/experimental/harris-8259-adapter.js';
import {Harris8254Adapter} from '../src/experimental/harris-8254-adapter.js';

const reset=p=>Number(p==='reset');
for(const Adapter of [HarrisDMAAdapter,HarrisFDCAdapter,HarrisKeyboardAdapter,Harris8259Adapter,Harris8254Adapter]) {
    test(`${Adapter.name} released-drive templates do not alias returned objects`,()=>{
        const device=new Adapter({enabled:true,transferEnabled:true});
        const first=device.update(reset);first.d0=1;first.extra=1;
        const second=device.update(reset);
        assert.notEqual(first,second);assert.equal(second.d0,'Z');assert.equal(second.extra,undefined);
        assert.equal(new Adapter({enabled:true,transferEnabled:true}).update(reset).d0,'Z');
    });
}
test('CPU released-data templates remain independent between bus instances',()=>{
    const first=new Harris80C286Bus({enabled:true}).beginClock(reset);first.d0=1;
    const second=new Harris80C286Bus({enabled:true}).beginClock(reset);
    assert.equal(second.d0,'Z');assert.notEqual(first,second);
});
