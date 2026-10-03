import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerPowerDevices} from '../src/devices/power.js';

registerPowerDevices();
const limits = {maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200};
const net = (id, ...pins) => ({id, terminals: pins.map(([part, terminal]) => ({part, terminal}))});
function rig(timed = false) {
    const b = new BoardImpl(5);
    b.configureTransientAnalysis('precision-v1');
    const parts = [
        {id:'G',kind:'gnd',params:{},terminals:['gnd']},
        {id:'V',kind:'vsource',params:{volts:8},terminals:['pos','neg']},
        {id:'R',kind:'resistor',params:{ohms:timed?500:1000},terminals:['a','b']},
        {id:'C',kind:'capacitor',params:{farads:timed?22e-6:1e-6},terminals:['a','b']}
    ];
    const nets = [net('zero',['G','gnd'],['V','neg'],['R','b'],['C','b']),
        net('out',['R','a'],['C','a'])];
    if (timed) {
        parts.push({id:'EN',kind:'vsource',params:{volts:3.3},terminals:['pos','neg']},
            {id:'U',kind:'adp7118',params:{vOut:5,rOut:.05,currentLimit:.36,
                startupModel:'current-limited-envelope'},
            terminals:['vout_1','vout_2','sense_adj','gnd','en','ss','vin_7','vin_8']});
        nets[0].terminals.push({part:'U',terminal:'gnd'},{part:'EN',terminal:'neg'});
        nets[1].terminals.push(...['vout_1','vout_2','sense_adj'].map(terminal => ({part:'U',terminal})));
        nets.push(net('vin',['V','pos'],['U','vin_7'],['U','vin_8']),net('en',['EN','pos'],['U','en']));
    } else {
        // Supply feeds R.a, storage and R.b share out.
        nets[0].terminals = nets[0].terminals.filter(p => !(p.part === 'R' && p.terminal === 'b'));
        nets[1].terminals = nets[1].terminals.filter(p => !(p.part === 'R' && p.terminal === 'a'));
        nets[1].terminals.push({part:'R',terminal:'b'});
        nets.push(net('vin',['V','pos'],['R','a']));
    }
    b.setNetlist(parts, nets);
    const scope = b.addScopeChannel({type:'voltage',netId:'out',referenceNetId:'zero',
        sampleRateHz:100000,depth:122,capture:'sample'});
    b.meterVoltage('out','zero');
    return {b, scope};
}

test('finite stream shares one budget and matches ordinary identical partitions exactly', () => {
    for (const timed of [false,true]) {
        const streamed=rig(timed), plain=rig(timed), observations=[];
        const end=timed?1200000n:105000n, step=10000n;
        const receipt=streamed.b.advanceToBoundedStream(end,limits,{stepNs:step,onStep: row => {
            assert.equal(row.qualified,false);
            assert.ok(Object.isFrozen(row)&&Object.isFrozen(row.work));
            assert.equal(row.timeNs,streamed.b.timeNs);
            assert.equal(streamed.b.transientAnalysisStatus().boundedAdvance,undefined);
            observations.push(row);
            streamed.b.meterVoltage('out','zero');
        }});
        for (let at=step;;at+=step) {const endpoint=at<end?at:end;plain.b.advanceTo(endpoint);
            plain.b.meterVoltage('out','zero');if(endpoint===end)break;}
        assert.deepEqual(streamed.b.getScopeData(streamed.scope),plain.b.getScopeData(plain.scope));
        assert.equal(streamed.b.meterVoltage('out','zero'),plain.b.meterVoltage('out','zero'));
        const {boundedAdvance,...status}=streamed.b.transientAnalysisStatus();
        assert.deepEqual(status,plain.b.transientAnalysisStatus());
        assert.equal(boundedAdvance,receipt);
        assert.equal(receipt.completed,true);
        assert.equal(receipt.failure,null);
        assert.equal(receipt.requestedTimeNs,String(end));
        assert.deepEqual(receipt.stream,{stepNs:String(step),observerCalls:observations.length});
        assert.equal(observations.at(-1).timeNs,end);
        assert.equal(observations.length,timed?120:11);
        for(let i=0;i<observations.length;i++)assert.equal(observations[i].index,i);
        assert.ok(Object.isFrozen(receipt.stream));
        assert.ok(receipt.work.solves<=limits.maxSolves&&receipt.work.advances<=limits.maxAdvances);
        assert.throws(()=>streamed.b.advanceToBoundedStream(end+step,limits,{stepNs:step,onStep(){}}),/fresh Board/);
    }
});

test('streamed passive RC observations match independent continuous waveform and integral', () => {
    const {b,scope}=rig(), end=100000n;
    b.advanceToBoundedStream(end,limits,{stepNs:10000n,onStep(){}});
    const data=b.getScopeData(scope);
    assert.equal(data.count,10);
    assert.equal(data.startTNs,10000n);
    for(let i=0;i<data.count;i++){
        const seconds=Number(data.startTNs+BigInt(i)*data.sampleIntervalNs)/1e9;
        assert.equal(data.samples[i*2],data.samples[i*2+1]);
        assert.ok(Math.abs(data.samples[i*2]-8*(1-Math.exp(-seconds/.001)))<5e-6);
    }
    const expectedMean=8*(1-.001/.0001*(1-Math.exp(-.0001/.001)));
    assert.ok(Math.abs(b.meterVoltage('out','zero')-expectedMean)<5e-6);
});

// Authored continuous piecewise RC/clamp solution, independent of engine steps.
function inrushReference() {
    const R=500,C=22e-6,A=5,r=.05,I=.36,duration=.0012;
    const tau=300e-6/Math.log(9),delay=Math.round((80e-6+tau*Math.log(.9))*1e9)/1e9;
    const k=R/(R+r),rho=C*R*r/(R+r),target=x=>A*(1-Math.exp(-x/tau));
    const initial=x=>A*k*(1-(tau*Math.exp(-x/tau)-rho*Math.exp(-x/rho))/(tau-rho));
    const bisect=(f,a,b)=>{for(let i=0;i<70;i++){const m=(a+b)/2;if(f(m)>0)b=m;else a=m;}return(a+b)/2;};
    const f=x=>target(x)-initial(x)-r*I;
    let entry,release;
    for(let x=1e-6;x<=duration;x+=1e-6)if(f(x)>0){entry=bisect(f,x-1e-6,x);break;}
    const limited=x=>I*R+(initial(entry)-I*R)*Math.exp(-(x-entry)/(R*C));
    const g=x=>-(target(x)-limited(x)-r*I);
    for(let x=entry+1e-6;x<=duration;x+=1e-6)if(g(x)>0){release=bisect(g,x-1e-6,x);break;}
    const P=x=>A*k*(1-tau*Math.exp(-x/tau)/(tau-rho));
    const voltage=t=>{const x=t-delay;if(x<=0)return 0;if(x<=entry)return initial(x);
        if(x<=release)return limited(x);return P(x)+(limited(release)-P(release))*Math.exp(-(x-release)/rho);};
    const F0=x=>A*k*(x+(tau*tau*Math.exp(-x/tau)-rho*rho*Math.exp(-x/rho))/(tau-rho));
    const F1=x=>I*R*x-(initial(entry)-I*R)*R*C*Math.exp(-(x-entry)/(R*C));
    const F2=x=>A*k*(x+tau*tau*Math.exp(-x/tau)/(tau-rho))
        -(limited(release)-P(release))*rho*Math.exp(-(x-release)/rho);
    const end=duration-delay;
    return {voltage,entry:entry+delay,release:release+delay,
        mean:(F0(entry)-F0(0)+F1(release)-F1(entry)+F2(end)-F2(release))/duration};
}

test('actual streamed ADP inrush matches independent clamp waveform/mean and simultaneous KCL',()=>{
    const {b,scope}=rig(true),reference=inrushReference();let sawLimit=false;
    const receipt=b.advanceToBoundedStream(1200000n,limits,{stepNs:10000n,onStep(){
        const output=b.branchCurrent('U','vout_1')+b.branchCurrent('U','vout_2');
        const delivered=-b.branchCurrent('U','vin_7')-b.branchCurrent('U','vin_8');
        const iq=50e-6+130e-6*Math.min(output,.2)/.2;
        assert.ok(output<=.36+1e-8&&output>=-1e-9);
        assert.ok(Math.abs(delivered-output-iq)<1e-10);
        assert.ok(Math.abs(output+b.branchCurrent('R','a')+b.branchCurrent('C','a'))<1e-10);
        if(Math.abs(output-.36)<1e-8)sawLimit=true;
    }});
    assert.equal(sawLimit,true);
    assert.ok(Math.abs(reference.entry-66.26866414968961e-6)<1e-12);
    assert.ok(Math.abs(reference.release-329.1432340371157e-6)<1e-12);
    const data=b.getScopeData(scope);assert.equal(data.count,120);
    for(let i=0;i<data.count;i++){
        const seconds=Number(data.startTNs+BigInt(i)*data.sampleIntervalNs)/1e9;
        assert.ok(Math.abs(data.samples[i*2]-reference.voltage(seconds))<5e-7,`inrush point ${i}`);
    }
    assert.ok(Math.abs(b.meterVoltage('out','zero')-reference.mean)<1e-6);
    assert.equal(receipt.completed,true);assert.equal(receipt.stream.observerCalls,120);
});

function exhaustionOracle(counter) {
    const {b,scope}=rig(), observations=[];
    const cap=counter==='advances'?2:counter==='solves'?15:5;
    assert.throws(()=>b.advanceToBoundedStream(100000n,{...limits,
        [`max${counter[0].toUpperCase()}${counter.slice(1)}`]:cap},
        {stepNs:10000n,onStep:r=>{observations.push(r);}}),/work budget exceeded/);
    const receipt=b.transientAnalysisStatus().boundedAdvance;
    assert.equal(receipt.completed,false);
    assert.equal(receipt.failure,'whole-advance-budget-exceeded');
    assert.equal(receipt.work[counter],cap);
    assert.ok(b.timeNs<100000n);
    if(counter==='advances')assert.equal(observations.length,2,'fails in a later chunk');
    assert.throws(()=>b.getScopeData(scope),/work budget exceeded/);
    assert.throws(()=>b.meterVoltage('out','zero'),/work budget exceeded/);
}
test('all three aggregate ceilings stop actual streamed work and invalidate observations',()=>{
    for(const counter of ['attempts','solves','advances'])exhaustionOracle(counter);
});

test('observer throw and async observer refuse completion and preserve ordinary error identity',()=>{
    for(const asynchronous of [false,true]){
        const {b,scope}=rig(), sentinel=new Error('observer cancelled');
        assert.throws(()=>b.advanceToBoundedStream(100000n,limits,{stepNs:10000n,onStep(){
            if(asynchronous)return Promise.resolve();throw sentinel;
        }}),error=>asynchronous?/synchronous observer/.test(error.message):error===sentinel);
        assert.equal(b.transientAnalysisStatus().boundedAdvance.completed,false);
        assert.throws(()=>b.getScopeData(scope));
    }
});

function caughtObserverOracle(reentrant=false){
    const {b,scope}=rig();let caught=0;
    assert.throws(()=>b.advanceToBoundedStream(100000n,limits,{stepNs:10000n,onStep(){
        try{if(reentrant)b.advanceToBounded(20000n,limits);else b.advanceTo(20000n);}
        catch{caught++;}
    }}),reentrant?/reentrant capture/:/observer cannot advance/);
    assert.equal(caught,1);
    assert.equal(b.timeNs,10000n);
    assert.equal(b.transientAnalysisStatus().boundedAdvance.completed,false);
    assert.throws(()=>b.getScopeData(scope));
}
test('caught raw-advance and reentrant refusals remain latched through final receipt',()=>{
    caughtObserverOracle();caughtObserverOracle(true);
});

test('invalid stream requests refuse before time or observation acquisition',()=>{
    for(const options of [null,{},[],{stepNs:0n,onStep(){}},{stepNs:1n,onStep(){}},
        {stepNs:10000,onStep(){}},{stepNs:10000n,onStep:0},{stepNs:10000n,onStep(){},extra:true}]){
        const {b}=rig();assert.throws(()=>b.advanceToBoundedStream(100000n,limits,options),/advanceToBoundedStream/);
        assert.equal(b.timeNs,0n);assert.equal(b.transientAnalysisStatus().boundedAdvance,undefined);
    }
});

test('three charge-bypass mutants fail actual stream caller oracles and restore the prototype',()=>{
    const original=BoardImpl.prototype._chargeBoundedAdvanceWork;
    try{for(const counter of ['attempts','solves','advances']){
        BoardImpl.prototype._chargeBoundedAdvanceWork=function(key){if(key!==counter)return original.call(this,key);};
        assert.throws(()=>exhaustionOracle(counter),assert.AssertionError);
    }}finally{BoardImpl.prototype._chargeBoundedAdvanceWork=original;}
    for(const counter of ['attempts','solves','advances'])exhaustionOracle(counter);
});

test('clearing caught observer failure latch fails the real callback refusal oracle',()=>{
    const original=BoardImpl.prototype.advanceTo;
    try{
        BoardImpl.prototype.advanceTo=function(target){
            try{return original.call(this,target);}catch(error){
                if(this._boundedAdvanceContext?.observing)this._boundedAdvanceContext.failure=null;
                throw error;
            }
        };
        assert.throws(()=>caughtObserverOracle(),assert.AssertionError);
    }finally{BoardImpl.prototype.advanceTo=original;}
    caughtObserverOracle();
});

test('resetting the budget per chunk fails the later-chunk hard-stop oracle',()=>{
    const original=BoardImpl.prototype.advanceTo;
    try{
        BoardImpl.prototype.advanceTo=function(target){
            const context=this._boundedAdvanceContext;
            if(context?.stream&&!context.observing)context.work={attempts:0,solves:0,advances:0};
            return original.call(this,target);
        };
        assert.throws(()=>exhaustionOracle('advances'),assert.AssertionError);
    }finally{BoardImpl.prototype.advanceTo=original;}
    exhaustionOracle('advances');
});
