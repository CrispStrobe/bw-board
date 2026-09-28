// Diagnostic only: observe successful instruction-fetch bytes without fetching
// memory or changing the ordinary 80386 executor.
export function attachI80386FetchCursorEligibility(machine) {
  const cpu = machine.cpu;
  if (!cpu || typeof cpu._fetch8 !== 'function' || typeof cpu._fetchN !== 'function')
    throw new TypeError('expected an 80386 AT machine');
  const original8 = cpu._fetch8;
  const originalN = cpu._fetchN;
  const reasons = Object.create(null);
  let previous = null;
  let fetchNFrame = null;
  let completedBytes = 0;
  let eligibleBytes = 0;
  let failedFetchCalls = 0;

  const identity = (eip) => {
    const cs = cpu.segmentCaches[1];
    return {
      cs, page: ((cs.base + (eip >>> 0)) >>> 0) >>> 12,
      cpl: cpu.currentPrivilegeLevel, cr0: cpu.cr0 >>> 0,
      cr3: cpu.cr3 >>> 0, cr4: cpu.cr4 >>> 0,
      generation: cpu._translationGeneration ?? null,
      cacheEnabled: !!cpu._translationCacheEnabled,
      a20Configured: !!machine._a20Configured,
      a20Enabled: !!machine.a20Enabled,
    };
  };
  const count = (startEip, n) => {
    for (let i = 0; i < n; i++) {
      const current = identity(startEip + i);
      let reason = 'eligible';
      if (!previous) reason = 'cold';
      else if (current.a20Configured !== previous.a20Configured ||
          current.a20Enabled !== previous.a20Enabled) reason = 'a20';
      else if (current.cs !== previous.cs) reason = 'cs';
      else if (current.cpl !== previous.cpl) reason = 'cpl';
      else if (current.cr0 !== previous.cr0) reason = 'cr0';
      else if (current.cr3 !== previous.cr3) reason = 'cr3';
      else if (current.cr4 !== previous.cr4) reason = 'cr4';
      else if (current.generation !== previous.generation) reason = 'generation';
      else if (current.cacheEnabled !== previous.cacheEnabled) reason = 'cacheEnabled';
      else if (current.page !== previous.page) reason = 'linearPage';
      completedBytes++;
      if (reason === 'eligible') eligibleBytes++;
      else reasons[reason] = (reasons[reason] ?? 0) + 1;
      previous = current;
    }
  };
  cpu._fetch8 = function (...args) {
    const start = this.eip;
    try {
      const value = original8.apply(this, args);
      count(start, 1);
      if (fetchNFrame) fetchNFrame.bytes++;
      return value;
    } catch (error) {
      if (!fetchNFrame) { previous = null; failedFetchCalls++; }
      throw error;
    }
  };
  cpu._fetchN = function (...args) {
    const start = this.eip;
    const before = this._instructionBytes ?? 0;
    const parent = fetchNFrame;
    const frame = {bytes: 0, failed: false};
    fetchNFrame = frame;
    try { return originalN.apply(this, args); }
    catch (error) { frame.failed = true; throw error; }
    finally {
      fetchNFrame = parent;
      // Slow-path _fetch8 calls were observed at their precise byte boundary.
      // The same-page path has no _fetch8 calls and is counted here.
      const delta = (this._instructionBytes ?? 0) - before;
      if (delta > frame.bytes) count(start + frame.bytes, delta - frame.bytes);
      if (parent) parent.bytes += delta;
      if (frame.failed) { previous = null; failedFetchCalls++; }
    }
  };
  return {
    report() {
      return {
        schema: 'bw.i80386-fetch-cursor-eligibility.v1',
        completedBytes, eligibleBytes,
        eligiblePercent: completedBytes ? 100 * eligibleBytes / completedBytes : 0,
        ineligibleReasons: {...reasons}, failedFetchCalls,
      };
    },
    detach() {
      cpu._fetch8 = original8;
      cpu._fetchN = originalN;
    },
  };
}
