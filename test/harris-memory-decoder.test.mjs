import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bitPins,bitDrives,readBits} from '../src/experimental/digital-circuit.js';
import {createHarrisMemoryDecoder} from '../src/experimental/harris-memory-decoder.js';
import {DigitalCircuit} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
const A=bitPins('a',24);
test('bound decoder matches generic decoder on window boundaries, byte lanes and unknown inputs',()=>{
    for(const lane of [0,1])for(const region of [{start:0,end:65536},{start:0xb8000,end:0xc0000},
        {start:0xff0000,end:0x1000000,romLowAlias:true}]) {
        const part=createHarrisMemoryDecoder({id:'decode',lane,...region});let pins={};
        const read=pin=>pins[pin],evaluate=part.compileEvaluate({pin:p=>()=>read(p),vector:ps=>()=>readBits(ps,read)});
        for(const address of [0,1,65535,65536,0xb7fff,0xb8000,0xbffff,0xc0000,0xeffff,0xf0000,0xfffff,0x100000,0xfeffff,0xff0000,0xffffff])
            for(const mio of [0,1,'X','Z'])for(const bhe of [0,1,'X','Z']) {
                pins={...bitDrives(A,address),m_io:mio,bhe_n:bhe};
                assert.deepEqual(evaluate(),part.evaluate(read));
                if(mio===0||lane===0&&(address&1)||lane===1&&bhe===1)assert.equal(evaluate().ce_n,1);
            }
        for(const pin of A)for(const level of ['X','Z']) {
            pins={...bitDrives(A,region.start),m_io:1,bhe_n:0,[pin]:level};
            assert.deepEqual(evaluate(),part.evaluate(read));assert.equal(evaluate().ce_n,'X');
        }
    }
});

test('specialized decoders bind edited wires, including swapped bits, breaks and contention',()=>{
    for(const edit of ['normal','swap','break','short']) {
        const parts=[{id:'source',pins:[...A,'m_io','bhe_n'],outputs:[...A,'m_io','bhe_n']},
            createHarrisMemoryDecoder({id:'decode',lane:1,start:0x10000,end:0x20000})];
        const wires=[...A,'m_io','bhe_n'].filter(p=>!(edit==='break'&&p==='a16')).map(pin=>({from:'source',
            fromTerminal:edit==='swap'?(pin==='a16'?'a17':pin==='a17'?'a16':pin):pin,to:'decode',toTerminal:pin}));
        if(edit==='short')wires.push({from:'source',fromTerminal:'a17',to:'decode',toTerminal:'a16'});
        const ref=new DigitalCircuit({enabled:true,parts,wires}),fast=new CompiledDigitalCircuit({enabled:true,parts,wires,compileEvaluators:true});
        for(const address of [0,0x10000,0x1ffff,0x20000,0x30000])for(const mio of [0,1,'X','Z']) {
            for(const c of [ref,fast]){c.drive('source',{...bitDrives(A,address),m_io:mio,bhe_n:0});c.settle();}
            assert.deepEqual(fast.snapshot,ref.snapshot,`${edit}/${address}/${mio}`);
            if(mio===1&&address===0x10000)assert.equal(fast.read('decode','ce_n'),edit==='normal'?0:edit==='swap'?1:'X');
        }
    }
});
