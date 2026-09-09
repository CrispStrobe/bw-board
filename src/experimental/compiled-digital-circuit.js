/** Default-off indexed ideal-net backend. Stateful device scheduling is unchanged.
 * The reference constructor validates/settles the actual netlist once; runtime
 * resolution below uses driver/net indices, not an alternative machine topology.
 */
import {DigitalCircuit,CircuitFault} from './digital-circuit.js';
const decode=[0,1,'X','Z'];
const encode=v=>v===0?0:v===1?1:v==='X'?2:v==='Z'?3:-1;
const keyOf=(part,pin)=>`${part}.${String(pin).toLowerCase()}`;

export class CompiledDigitalCircuit {
    #roots; #rootIndices; #bindings=new Map(); #bound=new Map();
    #driverNames; #driverNets; #netDrivers;
    #drivers; #defined; #publishedDrivers;
    #levels; #conflicts; #publishedLevels; #publishedConflicts;
    #dirty=new Set(); #evalDirty=new Set(); #snapshotDirty=new Set(); #driverDirty=new Set();
    #evaluators;
    constructor(options) {
        const reference=new DigitalCircuit(options);
        this.parts=reference.parts;this.parent=reference.parent;this.outputs=reference.outputs;
        this.maxDeltas=reference.maxDeltas;
        this.#roots=[...reference.snapshot.keys()];
        this.#rootIndices=new Map(this.#roots.map((root,i)=>[root,i]));
        this.#driverNames=[...this.outputs];
        const driverIndices=new Map(this.#driverNames.map((name,i)=>[name,i]));
        this.#driverNets=new Uint32Array(this.#driverNames.length);
        this.#netDrivers=this.#roots.map(()=>[]);
        this.#drivers=new Uint8Array(this.#driverNames.length);this.#drivers.fill(3);
        this.#defined=new Uint8Array(this.#driverNames.length);
        for(let d=0;d<this.#driverNames.length;d++) {
            const name=this.#driverNames[d],n=this.#rootIndices.get(this.parent.get(name));
            this.#driverNets[d]=n;this.#netDrivers[n].push(d);
            if(reference.drives.has(name)){this.#defined[d]=1;this.#drivers[d]=encode(reference.drives.get(name));}
        }
        for(const drivers of this.#netDrivers)drivers.sort((a,b)=>this.#driverNames[a].localeCompare(this.#driverNames[b]));
        this.#publishedDrivers=this.#drivers.slice();
        this.#levels=new Uint8Array(this.#roots.length);this.#conflicts=new Uint8Array(this.#roots.length);
        for(let n=0;n<this.#roots.length;n++) {
            const state=reference.snapshot.get(this.#roots[n]);this.#levels[n]=encode(state.value);this.#conflicts[n]=Number(state.conflict);
        }
        this.#publishedLevels=this.#levels.slice();this.#publishedConflicts=this.#conflicts.slice();
        for(const [id,part] of this.parts) {
            const bindings=new Map();
            for(const pin of part.pins) {
                const key=keyOf(id,pin);
                bindings.set(pin.toLowerCase(),{key,net:this.#rootIndices.get(this.parent.get(key)),driver:driverIndices.get(key)});
            }
            this.#bindings.set(id,bindings);
        }
        this.#evaluators=[...this.parts].filter(([,part])=>part.evaluate).map(([id,part])=>({id,part,
            roots:new Set(part.pins.map(pin=>this.#lookup(id,pin).net)),
            read:pin=>decode[this.#levels[this.#lookup(id,pin).net]]}));
        this.capabilities=Object.freeze({experimental:true,indexedConnectivity:true,eventScheduling:false,analog:false});
    }

    root(key) {const root=this.parent.get(key);if(root===undefined)throw new Error(`unknown terminal ${key}`);return root;}
    #lookup(part,pin) {
        const info=this.#bindings.get(part)?.get(String(pin).toLowerCase());
        if(!info)throw new Error(`unknown terminal ${keyOf(part,pin)}`);return info;
    }
    #apply(driver,value) {
        if(!this.#defined[driver]||this.#drivers[driver]!==value) {
            this.#defined[driver]=1;this.#drivers[driver]=value;
            this.#dirty.add(this.#driverNets[driver]);this.#driverDirty.add(driver);
        }
    }
    #drive(part,bindings,values) {
        const updates=[];
        for(const pin of Object.keys(values)) {
            const info=bindings?.get(pin.toLowerCase()),value=values[pin];
            if(info?.driver===undefined)throw new Error(`not an output ${keyOf(part,pin)}`);
            const code=encode(value);if(code<0)throw new Error(`invalid logic level ${value}`);
            updates.push(info.driver,code);
        }
        for(let i=0;i<updates.length;i+=2)this.#apply(updates[i],updates[i+1]);
    }
    drive(part,values) {this.#drive(part,this.#bindings.get(part),values);}

    #resolveDirty() {
        for(const n of this.#dirty) {
            let mask=0;
            for(const d of this.#netDrivers[n])if(this.#drivers[d]!==3)mask|=1<<this.#drivers[d];
            const conflict=Number((mask&3)===3),value=!mask?3:conflict||(mask&4)?2:(mask&1)?0:1;
            if(this.#levels[n]!==value)this.#evalDirty.add(n);
            this.#levels[n]=value;this.#conflicts[n]=conflict;this.#snapshotDirty.add(n);
        }
        this.#dirty.clear();
    }
    #state(n,published) {
        const levels=published?this.#publishedLevels:this.#levels,conflicts=published?this.#publishedConflicts:this.#conflicts;
        const values=published?this.#publishedDrivers:this.#drivers,drivers=[];
        for(const d of this.#netDrivers[n])if(values[d]!==3)drivers.push({pin:this.#driverNames[d],value:decode[values[d]]});
        return {value:decode[levels[n]],conflict:!!conflicts[n],drivers};
    }
    // Diagnostics are materialized only when requested, never per settled clock.
    get snapshot(){return new Map(this.#roots.map((root,n)=>[root,this.#state(n,true)]));}
    get drives(){return new Map(this.#driverNames.flatMap((name,d)=>this.#defined[d]?[[name,decode[this.#drivers[d]]]]:[]));}
    resolve(){this.#resolveDirty();return new Map(this.#roots.map((root,n)=>[root,this.#state(n,false)]));}
    settle() {
        if(this.resolve!==CompiledDigitalCircuit.prototype.resolve)throw new CircuitFault('UNSUPPORTED_COMPILED_OVERRIDE','select reference backend for custom resolution');
        if(!this.#dirty.size&&!this.#evalDirty.size&&!this.#snapshotDirty.size)return 0;
        for(let delta=0;delta<this.maxDeltas;delta++) {
            this.#resolveDirty();
            const changed=this.#evalDirty;this.#evalDirty=new Set();
            const staged=[],before=new Map();
            for(const entry of this.#evaluators) {
                let affected=false;for(const root of entry.roots)if(changed.has(root)){affected=true;break;}
                if(!affected)continue;
                const {id,part}=entry,values=part.evaluate(entry.read),updates=[];
                for(const pin of Object.keys(values))if(!part.outputs.includes(pin))throw new Error(`undeclared output ${id}.${pin}`);
                for(const pin of part.outputs) {
                    const d=this.#lookup(id,pin).driver;
                    if(!before.has(d))before.set(d,this.#defined[d]?this.#drivers[d]:4);
                    updates.push(d,values[pin]??'Z');
                }
                staged.push(updates);
            }
            // Match reference atomicity: validate each part's complete batch
            // before applying it; all evaluators read the same pre-drive state.
            for(const updates of staged) {
                for(let i=1;i<updates.length;i+=2){const code=encode(updates[i]);if(code<0)throw new Error(`invalid logic level ${updates[i]}`);updates[i]=code;}
                for(let i=0;i<updates.length;i+=2)this.#apply(updates[i],updates[i+1]);
            }
            let stable=true;for(const [d,value] of before)if((this.#defined[d]?this.#drivers[d]:4)!==value){stable=false;break;}
            if(stable) {
                for(const n of this.#snapshotDirty){this.#publishedLevels[n]=this.#levels[n];this.#publishedConflicts[n]=this.#conflicts[n];}
                for(const d of this.#driverDirty)this.#publishedDrivers[d]=this.#drivers[d];
                this.#snapshotDirty.clear();this.#driverDirty.clear();return delta;
            }
        }
        throw new CircuitFault('NON_CONVERGENT',`digital network did not settle in ${this.maxDeltas} deltas`);
    }
    inspect(part,pin){return this.#state(this.#lookup(part,pin).net,true);}
    read(part,pin){return decode[this.#publishedLevels[this.#lookup(part,pin).net]];}
    #require(info) {
        const value=this.#publishedLevels[info.net];if(value<2)return value;
        const state=this.#state(info.net,true);
        throw new CircuitFault(state.conflict?'CONTENTION':value===3?'FLOATING':'UNKNOWN',
            `${info.key} (${state.drivers.map(d=>`${d.pin}=${d.value}`).join(', ')||'no driver'})`);
    }
    require(part,pin){return this.#require(this.#lookup(part,pin));}
    bind(part) {
        if(this.#bound.has(part))return this.#bound.get(part);
        const bindings=this.#bindings.get(part);if(!bindings)throw new Error(`unknown part ${part}`);
        const lookup=pin=>{const info=bindings.get(String(pin).toLowerCase());if(!info)throw new Error(`unknown terminal ${keyOf(part,pin)}`);return info;};
        const bound=Object.freeze({read:pin=>decode[this.#publishedLevels[lookup(pin).net]],
            require:pin=>this.#require(lookup(pin)),drive:values=>this.#drive(part,bindings,values)});
        this.#bound.set(part,bound);return bound;
    }
}
