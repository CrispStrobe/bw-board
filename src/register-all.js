/**
 * Register every built-in device driver in one call.
 *
 * The registry pattern needs a caller: seventeen register* functions were
 * exported and invoked only by this repo's own tests, so every consumer of
 * the engine (the designer UI, the bundled app) ran with an EMPTY registry —
 * servo, timer_555, h-bridge and friends failed netlist validation as
 * "unknown kind" while their drivers sat here, complete and verified.
 * (Found 2026-08-10 when gallery examples loaded electrically dark.)
 *
 * Idempotent: registerDevice overwrites by kind, so calling twice is safe.
 */
import { registerLogicGates } from './devices/logic-gates.js';
import { registerRelay } from './devices/relay.js';
import { registerDCMotor } from './devices/dc-motor.js';
import { registerServo } from './devices/servo.js';
import { registerTimer555 } from './devices/timer-555.js';
import { registerPowerDevices } from './devices/power.js';
import { registerSensors } from './devices/sensors.js';
import { registerHBridge } from './devices/h-bridge.js';
import { registerMotorDrivers } from './devices/motor-drivers.js';
import { registerDisplayDevices } from './devices/display.js';
import { registerDigitalICs } from './devices/digital-ics.js';
import { registerLogicChips } from './devices/chip-composer.js';
import { registerAnalogICs } from './devices/analog-ics.js';
import { registerMiscParts } from './devices/misc-parts.js';
import { registerNamedParts } from './devices/named-parts.js';
import { registerTier1Parts } from './devices/tier1-parts.js';
import { registerI2CParts } from './devices/i2c-parts.js';

export function registerAllDevices() {
  registerLogicGates();
  registerRelay();
  registerDCMotor();
  registerServo();
  registerTimer555();
  registerPowerDevices();
  registerSensors();
  registerHBridge();
  registerMotorDrivers();
  registerDisplayDevices();
  registerDigitalICs();
  registerLogicChips();
  registerAnalogICs();
  registerMiscParts();
  registerNamedParts();
  registerTier1Parts();
  registerI2CParts();
}
