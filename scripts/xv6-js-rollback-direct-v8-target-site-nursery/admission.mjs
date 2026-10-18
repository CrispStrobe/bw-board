// Single-use admission; status is diagnostic and grants no grading authority.
export function makeAdmission() {
  let entered = false, poisoned = false, phase = 'created', fullGCCompleted = false, afterBegin = null;
  const admit = (runtime, fullGC, addon, flags) => {
    if (entered) { poisoned = true; throw Error('admission reentry'); }
    entered = true;
    phase = 'arguments';
    if (!runtime || Object.keys(runtime).sort().join(',') !== 'execArgv,node' ||
        runtime.node !== 'v20.20.2' || !Array.isArray(runtime.execArgv) ||
        runtime.execArgv.length !== 1 || runtime.execArgv[0] !== '--expose-gc' ||
        typeof fullGC !== 'function' || ![0, 2, 4].includes(flags))
      throw Error('admission arguments');
    if (poisoned) throw Error('admission reentry');
    phase = 'fullGC';
    fullGC(); // One synchronous invocation, bounded by the later hosted child limit.
    fullGCCompleted = true;
    if (poisoned) throw Error('admission reentry');
    phase = 'begin';
    addon.begin(flags);
    if (poisoned) throw Error('admission reentry');
    phase = 'facts';
    const count = addon.facts().gc.length;
    if (poisoned) throw Error('admission reentry');
    if (!Number.isSafeInteger(count) || count < 0 || count > 256)
      throw Error('nursery admission premise');
    afterBegin = count;
    if (count !== 0) throw Error('nursery admission premise');
    phase = 'admitted';
    return Object.freeze({ fullGCCompleted: true, afterBegin: count, afterSnapshot: null });
  };
  Object.defineProperty(admit, 'status', { value: () =>
    Object.freeze({ phase, fullGCCompleted, afterBegin }), writable: false, configurable: false });
  return Object.freeze(admit);
}
