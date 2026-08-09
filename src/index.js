/**
 * bw-board — the board layer between an emulated MCU and a circuit designer.
 *
 * Netlist, component models, pin resolution, instruments, and transducers.
 * No runtime dependencies. Runs in a browser or Node.
 *
 * @module bw-board
 */

export { BoardImpl } from './board.js';
export { pinThevenin, R_STRONG, R_QUASI_PULLUP } from './pin-model.js';
export { solveMNA } from './mna.js';
export { inferNetlist, checkWiring } from './infer-netlist.js';
export { runTrace } from './scripted-mcu.js';
export { runConformance, formatReport } from './conformance.js';
export { createEmu8051Adapter, formatPollingLossReport } from './emu8051-adapter.js';
export { createEmu8051DebugTarget } from './emu8051-debug.js';
export { createDebugSession } from './debug-session.js';
export { validateNetlist, assertValidNetlist } from './validate.js';
export { NetlistBuilder } from './builder.js';
export { createSerialDebugTarget } from './serial-debug.js';
export { createDebugTarget, getTargetKinds } from './debug-target-factory.js';
export { registerDevice, unregisterDevice, getDevice, registeredKinds, initDeviceState } from './devices.js';
export { registerLogicGates } from './devices/logic-gates.js';
export { registerRelay } from './devices/relay.js';
export { registerDCMotor } from './devices/dc-motor.js';
export { registerServo } from './devices/servo.js';
export { registerTimer555 } from './devices/timer-555.js';
export { registerPowerDevices } from './devices/power.js';
export { registerSensors } from './devices/sensors.js';
export { registerHBridge } from './devices/h-bridge.js';
export { registerMotorDrivers } from './devices/motor-drivers.js';
export { registerDisplayDevices } from './devices/display.js';
export { registerDigitalICs } from './devices/digital-ics.js';
export { registerLogicChips } from './devices/chip-composer.js';
export { registerAnalogICs } from './devices/analog-ics.js';
export { registerMiscParts } from './devices/misc-parts.js';
export { registerNamedParts } from './devices/named-parts.js';
export { registerTier1Parts } from './devices/tier1-parts.js';
export { registerI2CParts } from './devices/i2c-parts.js';
export { getMaxCurrent, CURRENT_RATINGS, PORT_LIMITS } from './current-ratings.js';
export { R_INPUT_PULLUP } from './pin-model.js';
