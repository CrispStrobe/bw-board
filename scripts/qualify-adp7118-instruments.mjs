// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';

export const CASES=Object.freeze([['linear',500,2.2e-6],['inrush',500,22e-6],['overload',10,2.2e-6]]
    .flatMap(([mode,R,C])=>[0,4].map(inputR=>Object.freeze({id:`adp-${mode}-r${inputR}`,mode,R,C,inputR}))));
export const CARD=Object.freeze({vOut:5,rOut:.05,currentLimit:.36,vin:8,en:3.3,
    delayNs:65615,tauSec:300e-6/Math.log(9),iqBase:50e-6,iqSlope:.00065,iqKnee:.2});
export const TIMES_NS=Object.freeze(Array.from({length:200},(_,i)=>(i+1)*6000));
export const WINDOW=Object.freeze({startNs:15000,endNs:1200000,observerStepNs:15000});
export const LIMITS=Object.freeze({maxAttempts:20000,maxSolves:60001,maxAdvances:200});
export const BOUNDS=Object.freeze({voltage:5e-7,outputCurrent:1e-5,inputCurrent:11e-6,
    meanVoltage:1e-6,meanOutputCurrent:1e-6,meanInputCurrent:1e-6});
export function definition(id) {const row=CASES.find(row=>row.id===id);if(!row)throw new Error(`Unknown reviewed ADP case: ${id}`);return row;}
const cache=new Map();
function root(f,a,b) {
    let fa=f(a);
    if(fa*f(b)>0)throw new Error('Reference transition must be bracketed');
    for(let i=0;i<70;i++){const m=(a+b)/2,fm=f(m);if(fa*fm<=0)b=m;else{a=m;fa=fm;}}
    return(a+b)/2;
}
function firstCrossing(f,a,b,direction) {
    const step=1e-7;
    for(let left=a;left<b;){const right=Math.min(b,left+step);
        if(direction*f(left)<=0&&direction*f(right)>0)return root(f,left,right);
        left=right;
    }
    return null;
}
// Closed piecewise solution of C*dV/dt = clip((target-V)/r,0,I)-V/R.
// No device wake, engine output, or inferred transition enters this reference.
export function reference(id) {
    if(cache.has(id))return cache.get(id);
    const row=definition(id),{R,C}=row,{vOut:A,rOut:r,currentLimit:I,tauSec:tau}=CARD;
    const delay=CARD.delayNs/1e9,end=WINDOW.endNs/1e9-delay,k=R/(R+r),rho=C*R*r/(R+r);
    const target=x=>A*-Math.expm1(-Math.max(0,x)/tau);
    const initial=x=>A*k*(tau*-Math.expm1(-x/tau)-rho*-Math.expm1(-x/rho))/(tau-rho);
    const initialArea=x=>A*k*(x-(tau*tau*-Math.expm1(-x/tau)-rho*rho*-Math.expm1(-x/rho))/(tau-rho));
    const entry=firstCrossing(x=>target(x)-initial(x)-r*I,0,end,1);
    const limited=x=>I*R+(initial(entry)-I*R)*Math.exp(-(x-entry)/(R*C));
    const release=entry===null?null:firstCrossing(x=>target(x)-limited(x)-r*I,entry+1e-12,end,-1);
    const particular=x=>A*k*(1-tau*Math.exp(-x/tau)/(tau-rho));
    const released=x=>particular(x)+(limited(release)-particular(release))*Math.exp(-(x-release)/rho);
    const voltage=t=>{const x=t-delay;if(x<=0)return 0;
        return entry===null||x<=entry?initial(x):release===null||x<=release?limited(x):released(x);};
    const voltageArea=t=>{
        const x=t-delay;if(x<=0)return 0;
        if(entry===null||x<=entry)return initialArea(x);
        const stop=release===null?x:Math.min(x,release),d=stop-entry;
        let sum=initialArea(entry)+I*R*d+(initial(entry)-I*R)*R*C*-Math.expm1(-d/(R*C));
        if(release!==null&&x>release){const length=x-release;
            sum+=A*k*(length+tau*tau*(Math.exp(-x/tau)-Math.exp(-release/tau))/(tau-rho))
                +(limited(release)-particular(release))*rho*-Math.expm1(-length/rho);
        }
        return sum;
    };
    const outputCurrent=t=>Math.min(I,Math.max(0,(target(t-delay)-voltage(t))/r));
    // Integrated capacitor/load KCL supplies the independent output-current
    // integral; it is not a quadrature of engine-reported amperes.
    const outputArea=t=>C*voltage(t)+voltageArea(t)/R;
    const knees=[];let left=delay,fl=outputCurrent(left)-CARD.iqKnee;
    while(left<WINDOW.endNs/1e9){const right=Math.min(WINDOW.endNs/1e9,left+1e-7),fr=outputCurrent(right)-CARD.iqKnee;
        if(fl*fr<0)knees.push(root(t=>outputCurrent(t)-CARD.iqKnee,left,right));
        left=right;fl=fr;
    }
    const inputCurrent=t=>{const q=outputCurrent(t);return q+CARD.iqBase+CARD.iqSlope*Math.min(q,CARD.iqKnee);};
    const inputArea=t=>{
        const points=[0,...knees.filter(x=>x<t),t];let clipped=0;
        for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];
            clipped+=outputCurrent((a+b)/2)>=CARD.iqKnee?CARD.iqKnee*(b-a):outputArea(b)-outputArea(a);
        }
        return outputArea(t)+CARD.iqBase*t+CARD.iqSlope*clipped;
    };
    const start=WINDOW.startNs/1e9,finish=WINDOW.endNs/1e9,duration=finish-start;
    const model=Object.freeze({entrySec:entry===null?null:entry+delay,releaseSec:release===null?null:release+delay,
        iqKneesSec:Object.freeze(knees),point(timeNs){
            if(!Number.isFinite(timeNs)||timeNs<0||timeNs>WINDOW.endNs)throw new Error('Reference time outside whole window');
            const t=timeNs/1e9;return{timeNs,voltage:voltage(t),outputCurrent:outputCurrent(t),inputCurrent:inputCurrent(t)};
        },mean:Object.freeze({startNs:WINDOW.startNs,endNs:WINDOW.endNs,
            voltage:(voltageArea(finish)-voltageArea(start))/duration,
            outputCurrent:(outputArea(finish)-outputArea(start))/duration,
            inputCurrent:(inputArea(finish)-inputArea(start))/duration})});
    cache.set(id,model);return model;
}

export function checkObservation(id,row) {
    const definitionRow=definition(id),c=row?.currents;
    const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-10;
    if(row?.qualified!==false||row.converged!==true||row.dirty!==false||!c
        ||!Number.isFinite(row.voltage)||!Number.isFinite(row.vin)||!Object.values(c).every(Number.isFinite)) {
        throw new Error('Published converged ADP observation required');
    }
    const q=c.output+c.duplicateOutput,input=-(c.input+c.duplicateInput);
    const iq=CARD.iqBase+CARD.iqSlope*Math.min(q,CARD.iqKnee);
    if(q< -1e-10||q>CARD.currentLimit+1e-10||!near(c.ground,iq)||!near(input,q+iq)
        ||!near(c.source,input)||!near(q+c.load+c.capacitor,0)||!near(q-input+c.ground,0)
        ||!near(c.load,-row.voltage/definitionRow.R)||!near(row.vin,CARD.vin-definitionRow.inputR*input)) {
        throw new Error('Simultaneous ADP output/load/supply KCL or IQ authority failed');
    }
}
export function compareCapture(id,engine) {
    definition(id);
    if(engine?.caseId!==id||engine.status?.profile?.id!=='precision-v1'||engine.status.accuracyMet!==true
        ||engine.status.failure!==null||engine.receipt?.completed!==true||engine.receipt.failure!==null
        ||engine.receipt.requestedTimeNs!==String(WINDOW.endNs)||engine.receipt.stream?.observerCalls!==80
        ||engine.receipt.stream.stepNs!==String(WINDOW.observerStepNs)
        ||Object.entries(LIMITS).some(([key,limit])=>{const used=engine.receipt.work?.[key.slice(3).toLowerCase()];
            return engine.receipt.limits?.[key]!==limit||!Number.isSafeInteger(used)||used<0||used>limit;})
        ||engine.modelState?.startupModel!=='current-limited-envelope'||engine.modelState.enabled!==true
        ||engine.observations?.length!==80||Array.from({length:80},(_,i)=>i)
            .some(i=>engine.observations[i]?.timeNs!==(i+1)*WINDOW.observerStepNs)
        ||engine.instrumentMetadata?.length!==3||[0,1,2].some(i=>{const d=engine.instrumentMetadata[i];return d?.count!==200
            ||d.writeIndex!==200||d.startTNs!=='6000'||d.sampleIntervalNs!=='6000'||d.capture!=='sample'
            ||(i>0&&d.currentClock!=='simulation');})
        ||engine.samples?.length!==200||TIMES_NS.some((t,i)=>engine.samples[i]?.timeNs!==t
            ||['voltage','outputCurrent','inputCurrent'].some(key=>!Number.isFinite(engine.samples[i]?.[key])))
        ||engine.mean?.startNs!==WINDOW.startNs||engine.mean?.endNs!==WINDOW.endNs
        ||['voltage','outputCurrent','inputCurrent'].some(key=>!Number.isFinite(engine.mean?.[key]))) {
        throw new Error('Complete native ADP instrument authority required');
    }
    engine.observations.forEach(row=>checkObservation(id,row));
    const expected=reference(id),check=(actual,expected,bound)=>({engine:actual,reference:expected,
        absoluteError:Math.abs(actual-expected),bound,passed:Math.abs(actual-expected)<=bound});
    const comparisons=engine.samples.map(row=>{const ref=expected.point(row.timeNs);return{timeNs:row.timeNs,
        ...Object.fromEntries(['voltage','outputCurrent','inputCurrent'].map(key=>[key,check(row[key],ref[key],BOUNDS[key])]))};});
    const means=Object.fromEntries(['voltage','outputCurrent','inputCurrent'].map(key=>[key,
        check(engine.mean[key],expected.mean[key],BOUNDS[`mean${key[0].toUpperCase()}${key.slice(1)}`])]));
    const passed=row=>['voltage','outputCurrent','inputCurrent'].every(key=>row[key].passed);
    return{agreement:comparisons.every(passed)&&passed(means),comparisons,means};
}

async function capture(id) {
    const row=definition(id),[{BoardImpl},{registerPowerDevices}]=await Promise.all([
        import('../src/board.js'),import('../src/devices/power.js')]);
    registerPowerDevices();const board=new BoardImpl(5);board.configureTransientAnalysis('precision-v1');
    const net=(id,...pins)=>({id,terminals:pins.map(([part,terminal])=>({part,terminal}))});
    board.setNetlist([
        {id:'G',kind:'gnd',params:{},terminals:['gnd']},
        {id:'VIN',kind:'vsource',params:{volts:8},terminals:['pos','neg']},
        {id:'EN',kind:'vsource',params:{volts:3.3},terminals:['pos','neg']},
        {id:'U',kind:'adp7118',params:{vOut:5,rOut:.05,currentLimit:.36,startupModel:'current-limited-envelope'},
            terminals:['vout_1','vout_2','sense_adj','gnd','en','ss','vin_7','vin_8']},
        {id:'RL',kind:'resistor',params:{ohms:row.R},terminals:['a','b']},
        {id:'C',kind:'capacitor',params:{farads:row.C},terminals:['a','b']},
        ...(row.inputR?[{id:'RS',kind:'resistor',params:{ohms:row.inputR},terminals:['a','b']}]:[])
    ],[net('zero',['G','gnd'],['VIN','neg'],['EN','neg'],['U','gnd'],['RL','b'],['C','b']),
        net('vin',['U','vin_7'],['U','vin_8'],...(row.inputR?[['RS','b']]:[['VIN','pos']])),
        net('en',['EN','pos'],['U','en']),net('out',['U','vout_1'],['U','vout_2'],['U','sense_adj'],['RL','a'],['C','a']),
        ...(row.inputR?[net('source',['VIN','pos'],['RS','a'])]:[])]);
    const options={capture:'sample',sampleRateHz:1e9/6000,depth:202};
    const handles=[board.addScopeChannel({type:'voltage',netId:'out',referenceNetId:'zero',...options}),
        board.addScopeChannel({type:'current',partId:'U',terminal:'vout_1',currentClock:'simulation',...options}),
        board.addScopeChannel({type:'current',partId:'VIN',terminal:'pos',currentClock:'simulation',...options})];
    const result={caseId:id,observations:[]};
    try {
        result.receipt=board.advanceToBoundedStream(BigInt(WINDOW.endNs),LIMITS,
            {stepNs:BigInt(WINDOW.observerStepNs),onStep:({timeNs})=>{
                if(timeNs===BigInt(WINDOW.startNs)){board.meterVoltage('out','zero');board.meterCurrent('U','vout_1');board.meterCurrent('VIN','pos');}
                const snapshot=board._mnaCache;
                result.observations.push({timeNs:Number(timeNs),qualified:false,
                    converged:snapshot?.converged??null,dirty:board._solveDirty===true,
                    voltage:board.nodeVoltages.get('out')??null,vin:board.nodeVoltages.get('vin')??null,
                    currents:Object.fromEntries([['output','U','vout_1'],['duplicateOutput','U','vout_2'],
                        ['input','U','vin_7'],['duplicateInput','U','vin_8'],['ground','U','gnd'],
                        ['load','RL','a'],['capacitor','C','a'],['source','VIN','pos']]
                        .map(([name,part,pin])=>[name,snapshot?.branchCurrents?.get(part)?.get(pin)??null]))});
            }});
        const data=handles.map(h=>board.getScopeData(h));
        result.instrumentMetadata=data.map(d=>({count:d.count,writeIndex:d.writeIndex,startTNs:String(d.startTNs),
            sampleIntervalNs:String(d.sampleIntervalNs),capture:d.capture,currentClock:d.currentClock}));
        if(data.some((d,i)=>d.count!==200||d.writeIndex!==200||d.startTNs!==6000n
            ||d.sampleIntervalNs!==6000n||d.capture!=='sample'||(i>0&&d.currentClock!=='simulation'))) {
            throw new Error('Native ADP scope grid/clock metadata refused');
        }
        result.samples=TIMES_NS.map((timeNs,i)=>{
            if(data.some(d=>d.samples[2*i]!==d.samples[2*i+1]))throw new Error('Native ADP paired observation refused');
            return{timeNs,voltage:data[0].samples[2*i],outputCurrent:data[1].samples[2*i],inputCurrent:data[2].samples[2*i]};
        });
        result.mean={startNs:WINDOW.startNs,endNs:WINDOW.endNs,voltage:board.meterVoltage('out','zero'),
            outputCurrent:board.meterCurrent('U','vout_1'),inputCurrent:board.meterCurrent('VIN','pos')};
    } catch(error){result.error=error.message;}
    result.status=board.transientAnalysisStatus();result.receipt||=result.status.boundedAdvance;
    const state=board.getDeviceState('U');result.modelState={startupModel:state.startupModel,enabled:state._enabled};
    return result;
}
export async function runCase(id) {
    const report={schema:'adp-native-instruments-v1',definition:definition(id),referenceCard:CARD,
        agreement:false,engine:null};
    try{report.engine=await capture(id);if(report.engine.error)return{...report,failure:'engine-capture',error:report.engine.error};
        return{...report,...compareCapture(id,report.engine)};
    }catch(error){return{...report,failure:'capture-authority',error:error.message};}
}
export function parseArguments(args) {
    if(!args.length)return CASES.map(row=>row.id);
    if(args.length!==2||args[0]!=='--case')throw new Error('Usage: qualify-adp7118-instruments.mjs [--case reviewed-id]');
    return[definition(args[1]).id];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
    let pass=true;
    for(const id of parseArguments(process.argv.slice(2))){const report=await runCase(id);
        console.log(JSON.stringify(report,(_k,v)=>typeof v==='bigint'?String(v):v));pass&&=report.agreement;}
    process.exitCode=pass?0:1;
}
