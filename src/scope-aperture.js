/** Opt-in voltage aperture means over piecewise-linear accepted observations.
 * An interval is publishable only when its entire duration was observed.
 * This finite aperture is a boxcar filter, not an ideal anti-alias filter.
 */
export function createScopeAperture(intervalNs, startNs) {
  if (typeof intervalNs !== 'bigint' || intervalNs <= 0n) throw new Error('Invalid scope aperture interval');
  return {intervalNs, endNs:startNs+intervalNs, area:0, previousTime:null, previousValue:null, observedFrom:null};
}

export function advanceScopeAperture(state, time, value, emit) {
  if (!Number.isFinite(time) || !Number.isFinite(value)) throw new Error('Nonfinite scope aperture observation');
  if (state.previousTime === null) {
    state.previousTime=time; state.previousValue=value; state.observedFrom=time;
    // Earlier, unobserved apertures never become manufactured samples.
    while (Number(state.endNs)/1e9 <= time) state.endNs+=state.intervalNs;
    return;
  }
  if (time < state.previousTime) throw new Error('Scope aperture observation time moved backwards');
  if (time === state.previousTime) {state.previousValue=value; return;}
  const previousTime=state.previousTime, previousValue=state.previousValue;
  let left=previousTime, leftValue=previousValue;
  while (left < time) {
    const end=Number(state.endNs)/1e9, right=Math.min(time,end);
    if (right <= left) throw new Error('Scope aperture interval is no longer representable');
    const rightValue=previousValue+(value-previousValue)*(right-previousTime)/(time-previousTime);
    state.area+=(leftValue+rightValue)*.5*(right-left);
    if (!Number.isFinite(state.area)) throw new Error('Nonfinite scope aperture integral');
    if (right === end) {
      const start=Number(state.endNs-state.intervalNs)/1e9;
      if (state.observedFrom <= start) emit(state.endNs,state.area/(Number(state.intervalNs)/1e9));
      state.area=0; state.endNs+=state.intervalNs;
    }
    left=right; leftValue=rightValue;
  }
  state.previousTime=time; state.previousValue=value;
}

/** A control edge changes the value at its time, without inventing a ramp
 * towards a discontinuity through the preceding unsampled interval. */
export function edgeScopeAperture(state, time, value, emit) {
  if (state.previousTime !== null && time > state.previousTime) {
    advanceScopeAperture(state,time,state.previousValue,emit);
  }
  advanceScopeAperture(state,time,value,emit);
}
