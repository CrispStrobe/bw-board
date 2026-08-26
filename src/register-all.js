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
import { registerAccelerometers } from './devices/accelerometers.js';
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
import { registerBoardKinds } from './devices/board-kinds.js';
import { registerHD44780 } from './devices/hd44780.js';
import { registerILI9341 } from './devices/ili9341.js';
import { registerMatrix8x8 } from './devices/matrix8x8.js';
import { registerDallasParts } from './devices/dallas-parts.js';
import { registerBoardICs } from './devices/board-ics.js';
import { registerTier2Parts } from './devices/tier2-parts.js';
import { registerTier3Parts } from './devices/tier3-parts.js';
import { registerBusMemory } from './devices/bus-memory.js';
import { registerRetroDips } from './devices/retro-dips.js';
import { registerMax232 } from './devices/max232.js';
import { registerResistorNetwork } from './devices/resistor-network.js';
import { registerST7920 } from './devices/st7920.js';
import { registerAdcSensors } from './devices/adc-sensors.js';
import { registerLevelMux } from './devices/level-mux.js';
import { registerBenchMeters } from './devices/bench-meters.js';
import { registerKitSensors } from './devices/kit-sensors.js';
import { registerRtcDisplay } from './devices/rtc-display.js';
import { registerThirtySeven } from './devices/thirtyseven.js';
import { registerAnalogAmps } from './devices/analog-amps.js';
import { registerMsgeq7 } from './devices/msgeq7.js';
import { registerUartPeer } from './devices/uart-peer.js';
import { registerRf433 } from './devices/rf433.js';
import { registerNrf24 } from './devices/nrf24.js';
import { registerAudioParts } from './devices/audio-parts.js';
import { registerMPU6050 } from './devices/mpu6050.js';
import { registerSSD1306 } from './devices/ssd1306.js';
import { registerUartFrame } from './devices/uart-frame.js';
import { registerSAP1Chips } from './devices/sap1-chips.js';
import { registerMCP4725 } from './devices/mcp4725.js';
import { registerUM245R } from './devices/um245r.js';
import { registerPS2Device } from './devices/ps2-device.js';
import { registerSimpleVGACard } from './devices/simplevga-card.js';
import { registerSevenseg8, registerLedbank8 } from './devices/a2-displays.js';
import { registerI2CSensors } from './devices/i2c-sensors.js';

export function registerAllDevices() {
  registerLogicGates();
  registerRelay();
  registerDCMotor();
  registerServo();
  registerTimer555();
  registerPowerDevices();
  registerSensors();
  registerAccelerometers();
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
  registerBoardKinds();
  registerHD44780();
  registerILI9341();
  registerMatrix8x8();
  registerDallasParts();
  registerBoardICs();
  registerTier2Parts();
  registerTier3Parts();
  registerBusMemory();
  registerRetroDips();
  registerMax232();
  registerResistorNetwork();
  registerST7920();
  registerAdcSensors();
  registerLevelMux();
  registerBenchMeters();
  registerKitSensors();
  registerRtcDisplay();
  registerThirtySeven();
  registerAnalogAmps();
  registerMsgeq7();
  registerUartPeer();
  registerRf433();
  registerNrf24();
  registerAudioParts();
  registerMPU6050();
  registerSSD1306();
  registerUartFrame();
  registerSAP1Chips();
  registerMCP4725();
  registerUM245R();
  registerPS2Device();
  registerSimpleVGACard();
  registerSevenseg8();
  registerLedbank8();
  registerI2CSensors();
}
