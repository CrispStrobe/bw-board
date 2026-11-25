// SPDX-License-Identifier: MIT
// A shaft owned by an external mechanics solver. The circuit still owns current,
// inductance and back-EMF; it integrates charge once per accepted time interval.
export function shaftElectricalStep(part, state, read, tNs) {
  const shaft = state.externalShaft;
  if (!shaft) return false;
  const resistance = part.params?.windingR ?? part.params?.R ?? 10;
  const kE = part.params?.kV ?? 0.01;
  const voltage = read('a') - read('b');
  const current = (voltage - kE * state.velocity) / resistance;
  if (![voltage, current].every(Number.isFinite)) throw new Error('Non-finite external shaft current');
  const dt = Number(tNs - shaft.lastNs) / 1e9;
  if (dt < 0) throw new Error('External shaft clock moved backwards');
  if (dt > 0) {
    shaft.chargeC += current * dt;
    shaft.armatureWorkJ += voltage * current * dt;
    shaft.copperLossJ += resistance * current * current * dt;
    shaft.lastNs = tNs;
  }
  shaft.voltageV = voltage;
  state.current = current;
  return true;
}

export function validateShaftSample(part, state, sample) {
  if (!sample || !Number.isFinite(sample.angleRad) || !Number.isFinite(sample.velocityRadS)) {
    throw new Error('A shaft sample needs finite radians and radians per second');
  }
  const shaft = state.externalShaft;
  if (!shaft) throw new Error('Motor shaft is not externally owned');
  if (part.kind === 'dc_motor_encoder') {
    const ppr = part.params?.pulsesPerRev ?? 20;
    if (!Number.isFinite(ppr) || ppr <= 0) throw new Error('Invalid encoder pulses per revolution');
    const edge = Math.floor(sample.angleRad / (2 * Math.PI) * ppr * 4);
    // A sampled mechanical port must never silently skip quadrature transitions.
    if (shaft.encoderEdge !== undefined && Math.abs(edge - shaft.encoderEdge) > 1) {
      throw new Error('Encoder exceeds mechanical sampling rate; reduce speed or pulses per revolution');
    }
    return edge;
  }
}

export function applyShaftSample(part, state, sample, supplyV, edge) {
  const shaft = state.externalShaft;
  if (edge !== undefined) {
    shaft.encoderEdge = edge;
    const phase = ((edge % 4) + 4) % 4;
    state.angle = sample.angleRad;
    state.count = edge;
    state.drives.enc_a = {vTh: phase < 2 ? supplyV : 0, rTh: 50};
    state.drives.enc_b = {vTh: phase === 1 || phase === 2 ? supplyV : 0, rTh: 50};
  }
  shaft.angleRad = sample.angleRad;
  // A disc on the shaft reads the owner's angle (motorShaftAngle).
  state.angle = sample.angleRad;
  state._angleAtSec = Number(shaft.lastNs ?? 0n) / 1e9;
  state.velocity = sample.velocityRadS;
  state.omega = Math.abs(sample.velocityRadS);
  state.direction = sample.velocityRadS > 0.01 ? 'forward' : sample.velocityRadS < -0.01 ? 'reverse' : 'stopped';
  if (part.kind === 'gearmotor') state.outputRpm = state.omega * 60 / (2 * Math.PI) / (part.params?.gearRatio ?? 48);
}

export function publishShaftState(part, state, sample, supplyV) {
  applyShaftSample(part, state, sample, supplyV, validateShaftSample(part, state, sample));
}
