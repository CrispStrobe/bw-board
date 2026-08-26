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
export { acSweep } from './ac.js';
export { inferNetlist, checkWiring } from './infer-netlist.js';
export { runTrace } from './scripted-mcu.js';
export { runConformance, formatReport } from './conformance.js';
export { parseIntelHex } from './intel-hex.js';
export { createEmu8051Adapter, formatPollingLossReport } from './emu8051-adapter.js';
export { createEmu8051DebugTarget } from './emu8051-debug.js';
export { createDebugSession } from './debug-session.js';
export { validateNetlist, assertValidNetlist } from './validate.js';
export { NetlistBuilder } from './builder.js';
export { createSerialDebugTarget } from './serial-debug.js';
export { createStm32Isp } from './stm32-isp.js';
export { createDebugTarget, getTargetKinds } from './debug-target-factory.js';
export { registerDevice, unregisterDevice, getDevice, hasDevice, registeredKinds, initDeviceState } from './devices.js';
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
export { registerBoardKinds } from './devices/board-kinds.js';
export { registerHD44780, createHD44780, hd44780Write8, hd44780Write4, hd44780ReadBF } from './devices/hd44780.js';
export { registerAllDevices } from './register-all.js';
export { registerAudioParts } from './devices/audio-parts.js';
export { registerMPU6050 } from './devices/mpu6050.js';
export { registerSSD1306, ssd1306Pixel } from './devices/ssd1306.js';
export { getMaxCurrent, CURRENT_RATINGS, PORT_LIMITS, aggregateCurrent, checkCurrentBudget } from './current-ratings.js';
export { R_INPUT_PULLUP } from './pin-model.js';
export { ControllerPanel, WIDGET_TYPES, WIDGET_DEFAULTS, DECORATION_TYPES } from './controller.js';
export { bindPanelToBoard, createControllerDriver } from './controller-binding.js';
export { ControllerExtension } from './controller-extension.js';
export { createControllerStageView, WIDGET_RENDER_INFO } from './controller-stage-view.js';
export { DataLogger } from './datalogger.js';
export { DataLoggerExtension } from './datalogger-extension.js';
export { STIMULUS_CATALOGUE, getStimulusParams, getStimulusKinds, getStimulusParts } from './stimulus-catalogue.js';
export { StimulusExtension } from './stimulus-extension.js';
export { runDcSweep, runAcSweep, correlateAt, logSpace } from './sweep.js';
// pin-functions.js is NODE-ONLY (it reads the bw-parts sibling checkout via
// node:fs) and is deliberately NOT exported here: this file is the browser
// entry, and a bundler handed a node:fs import fails the whole app build —
// the same lesson as vite-isms in runtime-agnostic modules, node flavour.
// Node-side consumers (tests, tooling) import './pin-functions.js' directly.
// Browser consumers get pin functions from bw-circuit-ui's VENDORED sidecar
// registry, which is the same bw-parts data through the sync pipeline.
export { describeMedia, applyMedia, parseIhex } from './machine-media.js';
