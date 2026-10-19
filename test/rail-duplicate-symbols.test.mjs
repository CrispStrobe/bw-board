/**
 * One constraint per rail: several power symbols on one net must not make the
 * matrix singular.
 *
 * A schematic conventionally draws one VCC symbol per connection point, so a
 * single rail routinely carries three, five, a dozen `vcc` parts. Each used to
 * get its own voltage-source row; two rows both enforcing V(net) = 5 leave the
 * current split between them indeterminate, the solve fails, and EVERY node —
 * the rail included — reads 0 V with converged:false and nothing naming the
 * cause. It presents as a board that imports cleanly and simulates dark.
 *
 * Found by running 26 imported EAGLE boards past lcapy: 25 failed here and
 * lcapy solved most of them. This is the minimal reproduction.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { solveMNA } from '../src/mna.js';
import { BoardImpl } from '../src/board.js';

const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const VCC = (id, volts) => ({ id, kind: 'vcc', params: volts === undefined ? {} : { volts }, terminals: ['vcc'] });
const GND = (id) => ({ id, kind: 'gnd', params: {}, terminals: ['gnd'] });

/** 5 V rail -> 1k -> mid -> 1k -> gnd, with `supplies` power symbols on the rail. */
function divider(supplies, grounds = [GND('G1')]) {
  const parts = [...supplies, ...grounds, R('R1', 1000), R('R2', 1000)];
  const nets = [
    { id: 'sup', terminals: [...supplies.map((v) => ({ part: v.id, terminal: 'vcc' })), { part: 'R1', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
    { id: 'gnd', terminals: [...grounds.map((g) => ({ part: g.id, terminal: 'gnd' })), { part: 'R2', terminal: 'b' }] },
  ];
  return solveMNA(parts, nets, new Map(), new Map(), 5);
}

describe('duplicate power symbols on one net', () => {
    for (const n of [1, 2, 3, 8]) {
        test(`${n} vcc symbol${n > 1 ? 's' : ''} on the rail still solves`, () => {
            const supplies = Array.from({ length: n }, (_, i) => VCC(`V${i + 1}`));
            const r = divider(supplies);
            assert.equal(r.converged, true, `${n} supplies: solver did not converge`);
            assert.ok(Math.abs(r.nodeVoltages.get('sup') - 5) < 1e-6,
                `rail reads ${r.nodeVoltages.get('sup')} V, not 5 — the all-zeros failure`);
            assert.ok(Math.abs(r.nodeVoltages.get('mid') - 2.5) < 1e-5,
                `divider midpoint reads ${r.nodeVoltages.get('mid')} V, not 2.5`);
        });
    }

    test('many ground symbols were always fine — gnd is not a source', () => {
        // Recorded so the fix is not mistaken for symmetry: only vcc allocated
        // a constraint row, so only vcc could duplicate one.
        const r = divider([VCC('V1')], [GND('G1'), GND('G2'), GND('G3'), GND('G4')]);
        assert.equal(r.converged, true);
        assert.ok(Math.abs(r.nodeVoltages.get('mid') - 2.5) < 1e-5);
    });

    test('two symbols demanding DIFFERENT voltages are reported, not averaged', () => {
        // This one is not a duplicate — it is a 5 V rail shorted to a 3.3 V
        // rail, which a schematic can genuinely express and which the user
        // needs told about. Silently keeping whichever was stamped first would
        // make a wiring error look like a working board.
        const r = divider([VCC('V1', 5), VCC('V2', 3.3)]);
        assert.equal(r.converged, true);
        assert.ok(Array.isArray(r.railConflicts) && r.railConflicts.length === 1,
            `expected a reported conflict, got ${JSON.stringify(r.railConflicts)}`);
        assert.match(r.railConflicts[0], /5 V and 3\.3 V/);
    });

    test('no conflict is reported when the symbols agree', () => {
        // Guards the other direction: a check that always fires is no check.
        const r = divider([VCC('V1', 3.3), VCC('V2', 3.3)]);
        assert.equal(r.railConflicts, undefined,
            `duplicates that agree are not a conflict, got ${JSON.stringify(r.railConflicts)}`);
        assert.ok(Math.abs(r.nodeVoltages.get('sup') - 3.3) < 1e-6);
    });
});

function railBench(count, {volts=5,reverse=false,load=1000}={}) {
    const supplies=Array.from({length:count},(_,i)=>VCC(`V${i+1}`,volts));
    if(reverse) supplies.reverse();
    const parts=[...supplies,GND('G'),R('LOAD',load)];
    const nets=[
        {id:'rail',terminals:[...supplies.map(p=>({part:p.id,terminal:'vcc'})),{part:'LOAD',terminal:'a'}]},
        {id:'ground',terminals:[{part:'G',terminal:'gnd'},{part:'LOAD',terminal:'b'}]},
    ];
    return {parts,nets,supplies};
}
const solved=fixture=>solveMNA(fixture.parts,fixture.nets,new Map(),new Map(),5);
const liveBoard=fixture=>{
    const board=new BoardImpl(5); board.setNetlist(fixture.parts,fixture.nets); return board;
};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} vs ${expected}`);

describe('aggregate rail current and indeterminate alias observations',()=>{
    test('current scope refuses an ambiguous alias without writing a false sample; valid voltage and load channels remain usable',()=>{
        const board=liveBoard(railBench(2));
        const voltage=board.addScopeChannel({type:'voltage',netId:'rail',capture:'sample',sampleRateHz:1000,depth:8});
        const alias=board.addScopeChannel({type:'current',partId:'V1',terminal:'vcc',depth:8});
        assert.throws(()=>board.sampleCurrentChannels(),error=>error.code==='INDETERMINATE_BRANCH_CURRENT');
        const unavailable=board.getScopeData(alias);
        assert.equal(unavailable.count,0);
        assert.ok([...unavailable.samples].every(Number.isNaN));
        board.advanceTo(2_000_000n);
        assert.ok(board.getScopeData(voltage).count>0,'voltage acquisition is not blocked by current sampling refusal');
        board.removeScopeChannel(alias);
        const load=board.addScopeChannel({type:'current',partId:'LOAD',terminal:'a',depth:8});
        near(board.sampleCurrentChannels().get(load),-.005);
        assert.equal(board.getScopeData(load).count,1);
        near(board.getScopeData(load).samples[0],-.005);
        const single=liveBoard(railBench(1));
        const supply=single.addScopeChannel({type:'current',partId:'V1',terminal:'vcc',depth:8});
        near(single.sampleCurrentChannels().get(supply),.005);
    });

    test('preserves signed total delivery for 1/2/3/8 symbols and their reverse order, marking every duplicate participant',()=>{
        for(const count of [1,2,3,8]) for(const reverse of [false,true]) for(const volts of [-5,0,5]){
            const fixture=railBench(count,{reverse,volts}); const result=solved(fixture);
            assert.equal(result.converged,true); near(result.nodeVoltages.get('rail'),volts);
            near(result.railCurrents.get('rail'),volts/1000);
            near(result.branchCurrents.get('LOAD').get('a'),-volts/1000);
            assert.deepEqual([...result.indeterminateBranchCurrents].sort(),
                count>1?fixture.supplies.map(p=>p.id).sort():[]);
            // Retain the internal owner's aggregate rather than distributing
            // current by guesswork; consumers must obey availability metadata.
            near([...result.branchCurrents.values()].reduce((sum,c)=>sum+(c.get('vcc')??0),0),volts/1000);
            const board=liveBoard(fixture); near(board.railCurrent('rail'),volts/1000);
            for(const p of fixture.supplies){
                if(count>1){
                    assert.throws(()=>board.branchCurrent(p.id,'vcc'),/indeterminate source current/);
                    assert.throws(()=>board.meterCurrent(p.id,'vcc'),/indeterminate source current/);
                }else near(board.meterCurrent(p.id,'vcc'),volts/1000);
                assert.equal(board.branchCurrent(p.id,'unknown'),0,'legacy unknown-terminal fallback unchanged');
            }
            near(board.meterVoltage('rail','ground'),volts);
            board.advanceTo(1_000_000n); near(board.railCurrent('rail'),volts/1000);
        }
    });

    test('keeps distinct rail totals separate and refuses unknown/conflicted rail observations',()=>{
        const fixture=railBench(2);
        fixture.parts.push(VCC('OTHER',3),R('OTHERLOAD',2000));
        fixture.nets.push({id:'other',terminals:[{part:'OTHER',terminal:'vcc'},{part:'OTHERLOAD',terminal:'a'}]});
        fixture.nets[1].terminals.push({part:'OTHERLOAD',terminal:'b'});
        const board=liveBoard(fixture); near(board.railCurrent('rail'),.005);near(board.railCurrent('other'),.0015);
        near(board.branchCurrent('OTHER','vcc'),.0015);
        assert.throws(()=>board.railCurrent('ground'),/not an ideal supply rail/);
        assert.throws(()=>board.railCurrent('missing'),/not an ideal supply rail/);
        const conflict=railBench(2); conflict.parts.find(p=>p.id==='V2').params.volts=3.3;
        const raw=solved(conflict);assert.equal(raw.converged,true);assert.equal(raw.railConflicts.length,1);
        assert.throws(()=>liveBoard(conflict).railCurrent('rail'),/rail conflict/);
        // OP preserves separate convergence and conflict metadata; its state
        // adoption refuses conflicts. Do not rewrite that existing contract.
        const invalid=liveBoard(conflict);
        assert.equal(invalid.operatingPoint().railConflicts.length,1);
        assert.throws(()=>invalid.initializeTransientFromOperatingPoint(),/rail conflict|conflicting/i);
    });

    test('power-off remains known zero and power-on does not let failed alias watches corrupt valid measurements',()=>{
        const fixture=railBench(3); const board=liveBoard(fixture);
        board.setPower(false); assert.equal(board.railCurrent('rail'),0);
        assert.throws(()=>board.railCurrent('missing'),/not an ideal supply rail/);
        for(const p of fixture.supplies){assert.equal(board.branchCurrent(p.id,'vcc'),0);assert.equal(board.meterCurrent(p.id,'vcc'),0);}
        assert.doesNotThrow(()=>board.setPower(true));
        for(const p of fixture.supplies) assert.throws(()=>board.meterCurrent(p.id,'vcc'),/indeterminate source current/);
        near(board.railCurrent('rail'),.005);near(board.meterCurrent('LOAD','a'),-.005);
        const reset=railBench(1);board.setNetlist(reset.parts,reset.nets);
        near(board.meterCurrent('V1','vcc'),.005);near(board.railCurrent('rail'),.005);
    });

    test('OP and adopted caches retain aggregate/current availability without changing OP sign convention or live state',()=>{
        for(const volts of [-5,5]){
            const fixture=railBench(3,{volts});const board=liveBoard(fixture);
            board.railCurrent('rail'); // Populate the live MNA cache, not the fast-path voltage-only state.
            const cache=board._mnaCache; const currents=[...cache.branchCurrents];
            const op=board.operatingPoint(); assert.equal(board.timeNs,0n);
            assert.equal(board._mnaCache,cache);assert.deepEqual([...cache.branchCurrents],currents);
            near(op.railCurrents.get('rail'),-volts/1000);
            assert.deepEqual([...op.indeterminateBranchCurrents].sort(),['V1','V2','V3']);
            board.initializeTransientFromOperatingPoint();near(board.railCurrent('rail'),volts/1000);
            for(const p of fixture.supplies) assert.throws(()=>board.branchCurrent(p.id,'vcc'),/indeterminate source current/);
            board.advanceTo(1n);near(board.railCurrent('rail'),volts/1000);
        }
    });

    test('aggregate observer refuses explicitly failed or nonfinite solve results rather than inventing zero',()=>{
        const board=liveBoard(railBench(1));
        const original=board._mnaCache;
        board._mnaCache={...original,converged:false};
        assert.throws(()=>board.railCurrent('rail'),/solve failed/);
        board._mnaCache={...original,railCurrents:new Map([['rail',NaN]])};
        assert.throws(()=>board.railCurrent('rail'),/no finite aggregate/);
        board._mnaCache={...original,railCurrents:new Map()};
        assert.throws(()=>board.railCurrent('rail'),/no finite aggregate/);
        board._mnaCache=original;near(board.railCurrent('rail'),.005);
    });

    test('unloaded rail retains the solver numerical shunt, not a unique alias current, and malformed net IDs always refuse',()=>{
        const fixture=railBench(3);
        fixture.parts=fixture.parts.filter(p=>p.id!=='LOAD');
        for(const net of fixture.nets) net.terminals=net.terminals.filter(t=>t.part!=='LOAD');
        const board=liveBoard(fixture); near(board.nodeVoltage('rail'),5);
        // Existing selective-node GMIN remains on this empty diagonal:
        // 5 V * 1 pS = 5 pA. Do not round a solved current to fabricated zero
        // or claim this numerical regularizer is a physical load/noise model.
        near(board.railCurrent('rail'),5*1e-12);
        for(const p of fixture.supplies) assert.throws(()=>board.branchCurrent(p.id,'vcc'),/indeterminate source current/);
        for(const on of [true,false]){
            board.setPower(on);
            for(const id of [undefined,null,'',42,{}]) assert.throws(()=>board.railCurrent(id),/nonempty net ID/);
        }
    });
});
