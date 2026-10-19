// Opt-in ordinary-step observer for a PDE -> PTE dependent read pair.
// The two instruction EIPs and report destination come from the environment.
// It never fetches guest bytes, translates a page, or changes guest execution.
import fs from 'node:fs';
import {ExperimentalI80386ATMachine} from
  '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386ReadWindow} from
  '../src/experimental/i80386-read-window.js';
import {prevalidateI80386DependentRead,
  isI80386DependentReadValid} from
  '../src/experimental/i80386-dependent-read-window.js';

const firstEip = Number(process.env.I80386_DEPENDENT_FIRST_EIP);
const secondEip = Number(process.env.I80386_DEPENDENT_SECOND_EIP);
const output = process.env.I80386_DEPENDENT_OUTPUT;
if (!Number.isInteger(firstEip) || !Number.isInteger(secondEip) || !output)
  throw new Error('I80386_DEPENDENT_FIRST_EIP, SECOND_EIP, OUTPUT required');

const report = {schema:'bw.i80386-dependent-read-pair-observer.v1',
  firstAttempts:0, firstCached:0, firstUncached:0,
  firstCompleted:0, firstUnexpectedExit:0,
  secondAttempts:0, secondMatched:0, secondUnmatched:0,
  accepted:0, refused:{}, samples:[]};
const refusal = reason => {
  report.refused[reason] = (report.refused[reason] ?? 0) + 1;
};
const originalStep = ExperimentalI80386ATMachine.prototype.step;
const pendingByMachine = new WeakMap();

ExperimentalI80386ATMachine.prototype.step = function(...args) {
  const cpu = this.cpu;
  const eip = cpu.eip >>> 0;
  let pending = pendingByMachine.get(this);
  if (pending && ++pending.age > 12) {
    pendingByMachine.delete(this);
    pending = null;
  }
  if (cpu.protectedMode && !cpu.virtual8086 && cpu.segmentCaches[1]?.default32 &&
      eip === firstEip) {
    const firstOffset = (cpu.esi + (cpu.edx * 4)) >>> 0;
    const firstWindow = prevalidateI80386ReadWindow(this, firstOffset, 3);
    report.firstAttempts++;
    if (firstWindow && (firstOffset & 0xfff) <= 4092)
      report.firstCached++;
    else report.firstUncached++;
    pending = {firstOffset, ebx:cpu.ebx >>> 0, age:0};
    pendingByMachine.set(this, pending);
    const cycles = cpu.cycles;
    const result = originalStep.apply(this, args);
    if (cpu.cycles > cycles && (cpu.eip >>> 0) === ((firstEip + 3) >>> 0)) {
      pending.firstValue = cpu.eax >>> 0;
      report.firstCompleted++;
    } else {
      pendingByMachine.delete(this);
      report.firstUnexpectedExit++;
    }
    return result;
  }
  if (cpu.protectedMode && !cpu.virtual8086 && cpu.segmentCaches[1]?.default32 &&
      eip === secondEip) {
    report.secondAttempts++;
    let reason = null, proof = null;
    const liveOffset = cpu.eax >>> 0;
    if (!pending || pending.firstValue === undefined) reason = 'no-completed-first';
    else {
      const firstOffset = (cpu.esi + (cpu.edx * 4)) >>> 0;
      const predicted = (((pending.firstValue & 0xfffff000) +
        ((cpu.ebx >>> 10) & 0xffc) + 0x80000000) >>> 0);
      if (firstOffset !== pending.firstOffset ||
          (cpu.ebx >>> 0) !== pending.ebx ||
          liveOffset !== predicted) reason = 'ordinary-derived-ea-mismatch';
      else {
        report.secondMatched++;
        const firstWindow = prevalidateI80386ReadWindow(this, firstOffset, 3);
        const secondWindow = prevalidateI80386ReadWindow(this, liveOffset, 3);
        const ebx = cpu.ebx >>> 0;
        proof = prevalidateI80386DependentRead(this, firstOffset, 4,
          firstValue => (((firstValue & 0xfffff000) +
            ((ebx >>> 10) & 0xffc) + 0x80000000) >>> 0), 4);
        if (!proof) reason = !firstWindow ? 'first-not-cached' :
          !secondWindow ? 'second-not-cached' : 'other-admission-guard';
        else if (proof.firstValue !== pending.firstValue ||
            proof.secondOffset !== liveOffset ||
            !isI80386DependentReadValid(proof))
          reason = 'stale-source-or-proof';
      }
    }
    if (reason) refusal(reason);
    else report.accepted++;
    if (reason === 'other-admission-guard' && !report.firstGuardSnapshot) {
      const codeWindow = prevalidateI80386ReadWindow(this, eip, 1);
      const firstWindow = prevalidateI80386ReadWindow(this,
        pending.firstOffset, 3);
      const secondWindow = prevalidateI80386ReadWindow(this,
        liveOffset, 3);
      report.firstGuardSnapshot = {
        cs:cpu.cs, ds:cpu.ds, eip, retainedRealCs:cpu._retainedRealCs,
        protectedMode:cpu.protectedMode, virtual8086:cpu.virtual8086,
        privilege:cpu.currentPrivilegeLevel,
        csCache:{...cpu.segmentCaches[1]}, dsCache:{...cpu.segmentCaches[3]},
        codePhysicalPage:codeWindow?.physicalPage ?? null,
        firstPhysicalPage:firstWindow?.physicalPage ?? null,
        secondPhysicalPage:secondWindow?.physicalPage ?? null,
        codePageKind:codeWindow ? this._page?.[codeWindow.physicalPage >>> 12] : null,
        firstPageKind:firstWindow ? this._page?.[firstWindow.physicalPage >>> 12] : null,
        secondPageKind:secondWindow ? this._page?.[secondWindow.physicalPage >>> 12] : null,
        a20Configured:this._a20Configured, a20Enabled:this._a20Enabled,
      };
    }
    if (report.samples.length < 16) report.samples.push({
      reason:reason ?? 'accepted', firstOffset:pending?.firstOffset ?? null,
      firstValue:pending?.firstValue ?? null, secondOffset:liveOffset,
      cr3:cpu.cr3 >>> 0, translationGeneration:cpu._translationGeneration,
      firstPhysicalPage:proof?.first?.physicalPage ?? null,
      secondPhysicalPage:proof?.second?.physicalPage ?? null});
    pendingByMachine.delete(this);
    return originalStep.apply(this, args);
  }
  return originalStep.apply(this, args);
};

process.on('exit', () => {
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
});
