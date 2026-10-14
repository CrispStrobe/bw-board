// SPDX-License-Identifier: MIT
// Integrate a polynomial through three actual accepted solution values.
// No fit to a part law, future solve, renewed budget or extra MNA work.
export function meterQuadraticSegment(startSec,midSec,endSec,y0,ym,y1) {
    if (![startSec,midSec,endSec,y0,ym,y1].every(Number.isFinite)
        || startSec<0 || !(startSec<midSec&&midSec<endSec)) {
        throw new Error('Invalid accepted meter quadratic segment');
    }
    return Object.freeze({startSec,midSec,endSec,y0,ym,y1});
}
export function meterQuadraticIntegral(segment,fromSec,toSec) {
    const {startSec,midSec,endSec,y0,ym,y1}=segment;
    meterQuadraticSegment(startSec,midSec,endSec,y0,ym,y1);
    if (![fromSec,toSec].every(Number.isFinite)||fromSec>toSec||fromSec<startSec||toSec>endSec) {
        throw new Error('Meter quadratic integral requires an observed clipped interval');
    }
    const duration=endSec-startSec,q=(midSec-startSec)/duration;
    const slope=(ym-y0)/q,curve=(y1-y0-slope)/(1-q),linear=slope-curve*q;
    const a=(fromSec-startSec)/duration,b=(toSec-startSec)/duration;
    const area=duration*(y0*(b-a)+linear*(b*b-a*a)/2+curve*(b*b*b-a*a*a)/3);
    if (![slope,curve,linear,area].every(Number.isFinite)) throw new Error('Non-finite meter quadratic integral');
    return area;
}
