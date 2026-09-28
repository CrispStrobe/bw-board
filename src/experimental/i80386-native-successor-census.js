// Opt-in, execution-neutral completed-native-call successor census.
// The dispatcher supplies actual post-call CS:EIP and direct-RAM/window checks;
// this accumulator never reads guest memory or changes machine state.
const bump = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };

export function createI80386NativeSuccessorCensus() {
  const counts = {completedCalls:0, retiredInstructions:0,
    exitReasons:{}, eventLimits:{}, postEventStatus:{},
    nextPcRelations:{}, successorStatuses:{},
    withinBlockLinks:{}, firstTranche:{}, optimisticElidableCalls:0};

  function observe(record) {
    if (!Number.isInteger(record?.retired) || record.retired < 1 ||
        !Number.isInteger(record.beforeEip) ||
        !Number.isInteger(record.afterEip))
      throw new TypeError('native successor census needs a completed call');
    counts.completedCalls++;
    counts.retiredInstructions += record.retired;
    bump(counts.exitReasons,record.resultReason);
    bump(counts.nextPcRelations,record.beforeCs !== record.afterCs
      ? 'cs-changed' : record.beforeEip === record.afterEip
        ? 'same-cs-same-eip' : 'same-cs-different-eip');
    bump(counts.successorStatuses,record.successorStatus);
    bump(counts.withinBlockLinks,record.linkedInside);

    let eventLimit='not-event';
    if (record.resultReason === 'event') {
      const minimum=Math.min(record.limits.caller,record.limits.chip,
        record.limits.lapic);
      const winners=Object.entries(record.limits)
        .filter(([,value])=>value===minimum).map(([name])=>name);
      eventLimit=record.retired!==minimum ? 'unknown' :
        winners.length===1?winners[0]:'tie-unknown';
    }
    bump(counts.eventLimits,eventLimit);
    bump(counts.postEventStatus,record.postChipDue
      ? record.postLapicDue ? 'chip-and-lapic' : 'chip'
      : record.postLapicDue ? 'lapic' : 'none');

    let tranche;
    if (record.resultReason !== 'done') tranche=`exit-${record.resultReason}`;
    else if (record.postChipDue || record.postLapicDue)
      tranche='post-event-boundary';
    else if (!record.sourceRegisterOnly) tranche='source-memory-or-repeat';
    else if (record.successorStatus !== 'cached-valid-register-only')
      tranche=`successor-${record.successorStatus}`;
    else if (record.beforeCs === record.afterCs &&
        record.beforeEip === record.afterEip) tranche='self-successor';
    else {tranche='optimistic-elidable';counts.optimisticElidableCalls++;}
    bump(counts.firstTranche,tranche);
  }

  function report() {
    const total=values=>Object.values(values).reduce((a,b)=>a+b,0);
    if ([counts.exitReasons,counts.eventLimits,counts.postEventStatus,
      counts.nextPcRelations,
      counts.successorStatuses,
      counts.withinBlockLinks,counts.firstTranche]
      .some(group=>total(group)!==counts.completedCalls))
      throw new Error('native successor census partition mismatch');
    return structuredClone(counts);
  }
  return {observe,report};
}
