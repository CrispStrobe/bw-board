/* @ts-self-types="./labwired_wasm.d.ts" */

/**
 * Shared lab air: nRF `VirtualAirBus` + ESP `BleAirBus` +
 * [`SimMqttFabric`] + optional path-loss [`RfMedium`]. Create ONE per
 * lab-group and pass it to every chip via `attach_lab_air` — same pattern as
 * [`WireBus`]. Path-loss CSQ and MQTT fabric share this air.
 */
class AirBus {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AirBusFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_airbus_free(ptr, 0);
    }
    /**
     * @param {string} topic
     * @returns {boolean}
     */
    cellular_has_publish(topic) {
        const ptr0 = passStringToWasm0(topic, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.airbus_cellular_has_publish(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @param {number} limit
     * @returns {string}
     */
    cellular_inspect(limit) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.airbus_cellular_inspect(this.__wbg_ptr, limit);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {string} topic
     * @returns {Uint8Array}
     */
    cellular_last_payload(topic) {
        const ptr0 = passStringToWasm0(topic, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.airbus_cellular_last_payload(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    clear_ble() {
        wasm.airbus_clear_ble(this.__wbg_ptr);
    }
    clear_cellular() {
        wasm.airbus_clear_cellular(this.__wbg_ptr);
    }
    clear_nrf() {
        wasm.airbus_clear_nrf(this.__wbg_ptr);
    }
    /**
     * Enable path-loss medium (seeded). Positions via `set_node_position`.
     * Co-located nodes stay lossless until placed apart.
     * @param {number} seed
     * @param {number} rssi_floor_dbm
     */
    enable_path_loss(seed, rssi_floor_dbm) {
        wasm.airbus_enable_path_loss(this.__wbg_ptr, seed, rssi_floor_dbm);
    }
    /**
     * Drop SimMqttFabric state (publish log + subscriptions).
     */
    mqtt_fabric_clear() {
        wasm.airbus_mqtt_fabric_clear(this.__wbg_ptr);
    }
    /**
     * True if any modem on this air published to `topic` (exact match).
     * @param {string} topic
     * @returns {boolean}
     */
    mqtt_fabric_has_publish(topic) {
        const ptr0 = passStringToWasm0(topic, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.airbus_mqtt_fabric_has_publish(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Inspect fabric: up to `limit` lines of `topic\\tpayload` (most recent first).
     * @param {number} limit
     * @returns {string}
     */
    mqtt_fabric_inspect(limit) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.airbus_mqtt_fabric_inspect(this.__wbg_ptr, limit);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Latest payload bytes for an exact topic, or empty if none.
     * @param {string} topic
     * @returns {Uint8Array}
     */
    mqtt_fabric_last_payload(topic) {
        const ptr0 = passStringToWasm0(topic, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.airbus_mqtt_fabric_last_payload(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    constructor() {
        const ret = wasm.airbus_new();
        this.__wbg_ptr = ret;
        AirBusFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Place a node (MCU part id) in metres for path-loss.
     * @param {string} node_id
     * @param {number} x
     * @param {number} y
     */
    set_node_position(node_id, x, y) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.airbus_set_node_position(this.__wbg_ptr, ptr0, len0, x, y);
    }
}
if (Symbol.dispose) AirBus.prototype[Symbol.dispose] = AirBus.prototype.free;
exports.AirBus = AirBus;

class WasmSimulator {
    static __wrap(ptr) {
        const obj = Object.create(WasmSimulator.prototype);
        obj.__wbg_ptr = ptr;
        WasmSimulatorFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmSimulatorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmsimulator_free(ptr, 0);
    }
    /**
     * Snapshot of the shared virtual-air TX trace ring buffer (last
     * ~200 BLE/proprietary frames pushed by any chip in this WASM
     * instance, most-recent-first). The playground's BLE-on-canvas
     * visualization polls this to render the packet trace panel; the
     * underlying state lives in a Rust static, so any WasmSimulator
     * can return the same snapshot — pick whichever chip is alive.
     * @returns {any}
     */
    air_trace_snapshot() {
        const ret = wasm.wasmsimulator_air_trace_snapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * Apply a binary `MachineRuntimeSnapshot` (LWRS-framed bincode blob,
     * produced by `labwired-cli snapshot capture` or `Machine::take_runtime_snapshot`)
     * to the currently-loaded machine. Bypasses the cold boot — the firmware
     * resumes mid-flight from the captured CPU + peripheral state.
     *
     * Must be called after firmware has been loaded onto the same system
     * manifest (peripheral names + CPU arch must match the snapshot). On
     * mismatch the call returns an error and the machine state is left
     * partially overwritten — callers should treat that as a hard reset.
     * @param {Uint8Array} bytes
     */
    apply_runtime_snapshot(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_apply_runtime_snapshot(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Bind this chip's nRF RADIO + ESP32-C3 BT + cellular modem to a shared
     * multi-chip [`AirBus`] (browser lab-group). `node_id` is the MCU part id
     * for path-loss layout and UE identity.
     * @param {string} node_id
     * @param {AirBus} air
     */
    attach_lab_air(node_id, air) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(air, AirBus);
        wasm.wasmsimulator_attach_lab_air(this.__wbg_ptr, ptr0, len0, air.__wbg_ptr);
    }
    /**
     * Connect this chip's UART (`uart_id`, e.g. "uart2") to a shared cross-link
     * `bus`, so it exchanges bytes with the other chip on the same `link_id`.
     * The two chips of a point-to-point IO-Link use opposite `side`s (0 and 1)
     * of the SAME `WireBus`. Bytes flow through the bus with no per-byte host
     * round-trip, so both chips can keep stepping in batches. Chips wired to
     * different `WireBus` instances are fully isolated.
     * @param {string} uart_id
     * @param {number} link_id
     * @param {number} side
     * @param {WireBus} bus
     */
    attach_uart_wire(uart_id, link_id, side, bus) {
        const ptr0 = passStringToWasm0(uart_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(bus, WireBus);
        const ret = wasm.wasmsimulator_attach_uart_wire(this.__wbg_ptr, ptr0, len0, link_id, side, bus.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Bench runner: execute `cycles` `step_with_esp32_aids` iterations
     * and return elapsed milliseconds (measured via
     * `performance.now()`). The caller drives this twice — once with
     * `set_jit_enabled(false)`, once with `set_jit_enabled(true)` —
     * and compares the two numbers to quantify JIT speedup.
     *
     * Returns a `Result<f64, JsValue>`: the `Err` path bubbles step
     * errors so the bench harness can show a useful message.
     * @param {number} cycles
     * @returns {number}
     */
    bench_jit(cycles) {
        const ret = wasm.wasmsimulator_bench_jit(this.__wbg_ptr, cycles);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * Non-consuming universal bus trace snapshot for logic analyzers.
     * Returns the shared bus event log (seq, bus, payload) grouped by bus type.
     * @returns {any}
     */
    bus_trace_snapshot() {
        const ret = wasm.wasmsimulator_bus_trace_snapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * Why the Serial pane can be empty while the firmware is talking.
     *
     * An ESP32-C3/S3 has two consoles and a board's USB socket is soldered to
     * exactly one of them, so the twin taps one — the same one the developer's
     * cable is on. If the firmware prints to the OTHER one, a real board shows
     * nothing and the twin faithfully shows nothing too. That is correct, and
     * completely baffling, so this says what happened.
     *
     * `null` when nothing was lost. See `labwired_core::console`.
     * @returns {string | undefined}
     */
    console_mismatch() {
        const ret = wasm.wasmsimulator_console_mismatch(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Drain UART TX output bytes accumulated since the last call.
     * @returns {Uint8Array}
     */
    drain_uart_output() {
        const ret = wasm.wasmsimulator_drain_uart_output(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Non-consuming FDCAN frame trace snapshot for CAN/UDS instruments.
     * @returns {any}
     */
    fdcan_trace_snapshot() {
        const ret = wasm.wasmsimulator_fdcan_trace_snapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * Push bytes into all UART RX buffers (bidirectional serial input).
     * @param {Uint8Array} data
     */
    feed_uart_input(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmsimulator_feed_uart_input(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Everything this machine failed to model so far, as a flat list of
     * [`labwired_core::fidelity::FidelityGap`].
     *
     * Phases 3.1-3.3 built the census — `record_undecoded` / `record_unmapped`
     * on the silent paths, `to_gaps()` to flatten it — and then only the CLI
     * ever read it. `to_gaps` had exactly three callers, all under `crates/cli`,
     * and the word "fidelity" appeared in this crate only inside comments. So
     * the engine knew precisely which instructions it had skipped and which
     * addresses nothing claimed, and the browser — where nearly every user
     * actually runs a lab — was never told. An undecoded instruction is a
     * silent no-op that leaves registers stale; it looks exactly like firmware
     * running correctly.
     *
     * Non-draining ON PURPOSE: this reads `report()`, not `take()`. A UI polls,
     * and `take()` would hand the gaps to whichever poll happened to land first
     * and show nothing to the next — a warning that blinks out is worse than no
     * warning. Scoping is done by resetting at construction instead, so the
     * list always means "gaps for the machine you are looking at".
     * @returns {any}
     */
    fidelity_gaps() {
        const ret = wasm.wasmsimulator_fidelity_gaps(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Browser-side GDB stub entry point.
     *
     * Disabled in this build: the GdbStub `Target` impl in `labwired-gdbstub`
     * is concrete on `LabwiredTarget<CortexM>` / `LabwiredTarget<RiscV>`,
     * but `WasmSimulator` now holds `Machine<Box<dyn Cpu>>` so the bound
     * isn't satisfied. The playground has no JS caller for this method,
     * so we return an empty packet rather than refactor `labwired-gdbstub`
     * to be dyn-aware. Track via the v0.6 plan.
     * @param {Uint8Array} _packet
     * @returns {Uint8Array}
     */
    gdb_process_packet(_packet) {
        const ptr0 = passArray8ToWasm0(_packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_gdb_process_packet(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Live actuator state for canvas animation.
     *
     * Returns servo states followed by configured motor-plant states.
     * - hobby servos (`kind: "servo"`) export shaft `angle` in degrees
     * - `dc-motor` exports scalar `current_a`
     * - `bldc-motor` exports DC-bus `current_a`, `phase_currents_a`, and
     *   `commutation_sector`
     *
     * Ids match the diagram part id / external_devices id so the UI maps
     * straight onto `boardIoStates[partId]`.
     * @returns {any}
     */
    get_actuator_states() {
        const ret = wasm.wasmsimulator_get_actuator_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * Read back NTC thermistor state from `external_devices` + live analog kit.
     *
     * Returns `[{ id, kind: "ntc-thermistor", divider_mv, adc_count }]`.
     * Identity is the external_devices id (no board_io twin).
     * @returns {any}
     */
    get_adc_device_states() {
        const ret = wasm.wasmsimulator_get_adc_device_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns analog state for ADC and PWM board_io bindings.
     * @returns {any}
     */
    get_board_io_analog_states() {
        const ret = wasm.wasmsimulator_get_board_io_analog_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the board_io configuration as a JSON array.
     * Each entry: { id, kind, peripheral, pin, signal, active_high }
     * @returns {any}
     */
    get_board_io_config() {
        const ret = wasm.wasmsimulator_get_board_io_config(this.__wbg_ptr);
        return ret;
    }
    /**
     * Returns the current state of all board_io bindings as a JSON array.
     * Each entry: { id, active }
     * Uses peripheral snapshot() to read ODR regardless of register layout.
     * @returns {any}
     */
    get_board_io_states() {
        const ret = wasm.wasmsimulator_get_board_io_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    get_disassembly() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsimulator_get_disassembly(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * **THE door.** Whatever the display called `device_id` is showing — any
     * model, any transport, any chip, however it was bound.
     *
     * Returns `null` when there is no such display, otherwise:
     *
     * ```text
     * { id, kind, format, width, height, bytes, text, meta }
     * ```
     *
     * * `kind` — `"framebuffer"` (packed pixels) or `"text_display"` (decoded
     *   characters). Between them, every way this engine has of saying "a human
     *   can see this".
     * * `format` — how `bytes` are packed (`"rgb565_be"`, `"ssd1306_page"`,
     *   `"epaper_tricolor_1bpp_planes"`, …).
     * * `width` / `height` — the panel's own geometry, in pixels (or in
     *   characters, for a text display), `null` when the model reports none.
     * * `bytes` — the payload, present only when `include_bytes`.
     * * `text` — the decoded string, for a `text_display`.
     * * `meta` — everything else the model chose to report (ink counts, power
     *   state, `generation`, `refresh_generation`), so a caller can poll for
     *   change without pulling pixels.
     *
     * **Geometry and packing are DATA, deliberately.** The accessors this
     * replaces carried them as prose in a doc comment — "153,600 bytes =
     * 240×320×2, big-endian RGB565" — which is lore that lives in the reader.
     * A model that arrives tomorrow cannot put anything into last year's doc
     * comment, so every new panel needed a new accessor AND a new renderer
     * branch before it could show a single pixel. Here a caller can paint a
     * display it has never heard of, and a new model is renderable the day its
     * own `artifacts()` lands.
     *
     * `generation` is stringified: it is a 64-bit FNV hash, and a `u64` past
     * 2^53 makes `serde_wasm_bindgen` refuse the WHOLE payload. That is not
     * hypothetical — it is why [`Self::inspect`] currently returns `null` for
     * every machine that has a device with an artifact.
     * @param {string} device_id
     * @param {boolean} include_bytes
     * @returns {any}
     */
    get_display(device_id, include_bytes) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_display(this.__wbg_ptr, ptr0, len0, include_bytes);
        return ret;
    }
    /**
     * Read back live I²C sensor samples for the canvas.
     *
     * Identity comes from `external_devices:` (the one home for bus parts) —
     * **not** a second `board_io` twin. Returns
     * `[{ id, kind: "adxl345", x, y, z }, ...]` or
     * `[{ id, kind: "mpu6050", ax, ay, az, gx, gy, gz }, ...]`.
     *
     * BME280 is intentionally OMITTED: its model has no register-backed
     * engineering-unit sample API for the panel (SimInput is the stimulus path).
     * @returns {any}
     */
    get_i2c_sensor_states() {
        const ret = wasm.wasmsimulator_get_i2c_sensor_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * Return the ILI9341 RGB565 framebuffer for the device identified by `device_id`.
     *
     * Returns a 153,600-byte `Uint8Array` (240×320 pixels × 2 bytes, row-major, big-endian RGB565).
     * Returns a JS error if the device is not found.
     * @param {string} device_id
     * @returns {Uint8Array}
     */
    get_ili9341_framebuffer(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_ili9341_framebuffer(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Read the IO-Link master peer's live state: `{ link_state, pd_valid,
     * input_byte }`. Returns `null` if no master is wired.
     * @returns {any}
     */
    get_iolink_master_state() {
        const ret = wasm.wasmsimulator_get_iolink_master_state(this.__wbg_ptr);
        return ret;
    }
    /**
     * Return the visible text of the LCD1602 identified by `device_id`.
     *
     * Returns exactly 32 characters — row 0 then row 1, no separator — so the
     * caller slices `[0..16]` and `[16..32]`. A display the firmware has not
     * switched on reads as all spaces, matching the dark panel.
     * Returns a JS error if the device is not found.
     *
     * The panel's evidence carries this text in `meta.text`, so this reads the
     * same string the CLI and `inspect` print rather than a second decode.
     * The default address matches the kit's own: 0x27, the PCF8574T backpack.
     * @param {string} device_id
     * @returns {string}
     */
    get_lcd1602_text(device_id) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmsimulator_get_lcd1602_text(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Return the MAX7219 LED-matrix framebuffer for the device identified by `device_id`.
     *
     * Returns an 8-byte `Uint8Array`: one byte per matrix row, row 0 first,
     * bit 7 = the leftmost column (`SEG A` on the driver). The bytes already
     * account for shutdown (all zero) and display test (all `0xFF`), so the
     * renderer can paint them directly.
     * Returns a JS error if the device is not found.
     * @param {string} device_id
     * @returns {Uint8Array}
     */
    get_led_matrix_framebuffer(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_led_matrix_framebuffer(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Legacy LED state query (hardcoded GPIOB pin 5 for backward compat).
     * @returns {boolean}
     */
    get_led_state() {
        const ret = wasm.wasmsimulator_get_led_state(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get_pc() {
        const ret = wasm.wasmsimulator_get_pc(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Return the PCD8544 (Nokia 5110) framebuffer for the device identified
     * by `device_id`.
     *
     * Returns 504 bytes: 84 columns × 6 banks, bank-major. Pixel (x, y) is
     * bit `(y % 8)` of byte `[(y / 8) * 84 + x]` (1 = on/dark).
     * @param {string} device_id
     * @returns {Uint8Array}
     */
    get_pcd8544_framebuffer(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_pcd8544_framebuffer(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * List all peripherals: [{ name, base_address }]
     * @returns {any}
     */
    get_peripheral_list() {
        const ret = wasm.wasmsimulator_get_peripheral_list(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get a peripheral's full state snapshot as JSON.
     * @param {string} name
     * @returns {any}
     */
    get_peripheral_snapshot(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_peripheral_snapshot(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * @param {number} id
     * @returns {number}
     */
    get_register(id) {
        const ret = wasm.wasmsimulator_get_register(this.__wbg_ptr, id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @returns {any}
     */
    get_register_names() {
        const ret = wasm.wasmsimulator_get_register_names(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Return the character shown on the direct-drive 7-segment digit
     * identified by `device_id`.
     *
     * Returns the single decoded character, with `'.'`
     * appended when the decimal point is lit — so a blank digit is `" "`,
     * a lit `0` is `"0"`, and `0` with the dp is `"0."`. An unrecognised
     * segment pattern decodes to `"?"` rather than silently blanking.
     *
     * The lit-segment mask is polarity-normalised by the model (COM low =
     * common cathode, COM high = common anode), so the text reads the same
     * either way it is wired.
     * @param {string} device_id
     * @returns {string}
     */
    get_seven_segment_text(device_id) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmsimulator_get_seven_segment_text(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Return the SH1107 GDDRAM framebuffer for the device identified by `device_id`.
     *
     * Returns a 2048-byte `Uint8Array` (128 columns × 16 pages, page-major) — the
     * same bit layout as the SSD1306, just twice as tall (128 rows).
     * Returns a JS error if the device is not found.
     * @param {string} device_id
     * @returns {Uint8Array}
     */
    get_sh1107_framebuffer(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_sh1107_framebuffer(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Read the 74HC165's live input byte (bit `i` = channel `i`), or `-1` if
     * no shifter is wired. Lets the UI reflect the device's real state rather
     * than tracking it in JS.
     * @returns {number}
     */
    get_sn74hc165_inputs() {
        const ret = wasm.wasmsimulator_get_sn74hc165_inputs(this.__wbg_ptr);
        return ret;
    }
    /**
     * Read back the current state of each SPI sensor declared in `board_io`.
     * Returns `[{ id, kind: "max31855", tc_c, internal_c }, ...]`.
     * @returns {any}
     */
    get_spi_device_states() {
        const ret = wasm.wasmsimulator_get_spi_device_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * Return the SSD1306 GDDRAM framebuffer for the device identified by `device_id`.
     *
     * Returns a 1024-byte `Uint8Array` (128 columns × 8 pages, page-major) for
     * the 128×64 panel. Both SSD1306 form factors surface through this one
     * accessor: the framebuffer length (1024 vs 512 bytes) is what tells the
     * renderer the panel height, so one readback path serves both.
     * Returns a JS error if the device is not found.
     * @param {string} device_id
     * @returns {Uint8Array}
     */
    get_ssd1306_framebuffer(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_ssd1306_framebuffer(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Return the SSD1680 tri-color e-paper framebuffer for the device identified by `device_id`.
     *
     * Returns a 9472-byte `Uint8Array`: first 4736 bytes are the black plane
     * (1 = white / 0 = black), next 4736 bytes are the red plane on the wire
     * (1 = no-red / 0 = red — see GxEPD2 inversion in writeImage). Row-major,
     * 128 pixels wide / 296 tall native, MSB-first packing within each byte.
     * Returns a JS error if the device is not found.
     * @param {string} device_id
     * @returns {Uint8Array}
     */
    get_ssd1680_framebuffer(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_ssd1680_framebuffer(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Cheap accessor returning just the SSD1680 refresh-generation counter.
     * UI uses this to decide whether to re-fetch the (larger) framebuffer.
     * @param {string} device_id
     * @returns {number}
     */
    get_ssd1680_refresh_generation(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_ssd1680_refresh_generation(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Return the decoded four-character text currently latched into a TM1637
     * 4-digit display. The TM1637 is GPIO bit-banged, so it is stored on the
     * bus side rather than inside a hardware bus peripheral.
     * @param {string} device_id
     * @returns {string}
     */
    get_tm1637_text(device_id) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmsimulator_get_tm1637_text(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Read back the current state of all NEO-6M GPS devices declared in `board_io`.
     * Returns `[{ id, kind: "neo6m-gps", lat, lon, has_fix }]`.
     * @returns {any}
     */
    get_uart_device_states() {
        const ret = wasm.wasmsimulator_get_uart_device_states(this.__wbg_ptr);
        return ret;
    }
    /**
     * Same shape as [`Self::get_ssd1680_framebuffer`], kept as a separate name
     * because the UI selects an accessor by the diagram part's type.
     *
     * It resolves to the SAME query: a tri-color e-paper on the bound
     * controller, whichever of the two controller models the builder attached.
     * That is not a shortcut — it is the honest reading of a `board_io`
     * `device_type:` that says `ssd1680_tricolor_290` for a panel the ESP32
     * builder attaches as a `Uc8151dTricolor290`. This accessor already ignored
     * the declared type for exactly that reason; now its twin does too, so a
     * lab can no longer render blank purely because the UI picked the accessor
     * named after the type string rather than the one named after the model.
     * @param {string} device_id
     * @returns {Uint8Array}
     */
    get_uc8151d_framebuffer(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_uc8151d_framebuffer(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * Cheap accessor returning just the UC8151D refresh-generation counter.
     * @param {string} device_id
     * @returns {number}
     */
    get_uc8151d_refresh_generation(device_id) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_get_uc8151d_refresh_generation(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Cumulative cycles advanced by idle fast-forward (WFI skip), not
     * interpreted. Browser `?perf=1` uses this to prove FF is firing; stays
     * 0 when FF is off or firmware never parks in a skippable idle.
     * @returns {bigint}
     */
    idle_fast_forward_cycles_skipped() {
        const ret = wasm.wasmsimulator_idle_fast_forward_cycles_skipped(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Universal inspect: decoded register + artifact state for one peripheral
     * (`name = Some`) or all (`name = None`). Serializes a
     * [`labwired_core::inspect::MachineInspect`]. In summary mode
     * (`include_bytes = false`) large artifact payloads (framebuffers) are
     * omitted; each artifact still carries `meta.generation` so the UI can skip
     * re-pulling unchanged buffers. Snapshot semantics — reads the current
     * paused machine state, side-effect-free.
     *
     * Two fields of that payload changed shape and the UI must handle both:
     * `devices` (new) lists the external I²C/SPI devices the manifest placed,
     * which are owned by their controller and so never appeared under
     * `peripherals`; and `peripherals[].registers[].value` is now `null`
     * rather than `0` when the model did not answer the probe, so an
     * unmodeled-but-named register must render as unknown, not as zero.
     * @param {string | null | undefined} name
     * @param {boolean} include_bytes
     * @returns {any}
     */
    inspect(name, include_bytes) {
        var ptr0 = isLikeNone(name) ? 0 : passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_inspect(this.__wbg_ptr, ptr0, len0, include_bytes);
        return ret;
    }
    /**
     * Arduino-ESP32 boot bootstrap (symbol-table autodiscovery).
     *
     * Mirrors the CLI's `arduino-esp32` snapshot-capture profile —
     * resolves Arduino-ESP32 thunk PCs from the ELF symbol table instead
     * of hand-curated hardcoded addresses. Works for any GxEPD2-class
     * sketch (labwired-ereader, future user sketches) without needing
     * to know its binary layout in advance.
     *
     * Caller must pass the same ELF bytes that were loaded via
     * `load_firmware`. The thunks are installed as flash patches over
     * the resolved PCs; calling this without the matching ELF is a no-op
     * (symbols don't resolve → no thunks installed).
     *
     * Attaches no peripheral of its own: the panel (model, CS, DC) comes
     * from the board manifest via `attach_esp32_external_devices` at system
     * load — see the body below. This method used to hardcode a panel here;
     * that behaviour is gone, and the manifest is the single source of truth.
     *
     * For the record, because the deleted comment had it backwards:
     * `GxEPD2_290_C90c` is an **SSD1680** controller (0x12 SWRESET, 0x11 data
     * entry, 0x24/0x26 RAM, 0x22+0x20 update), not UC8151D. UC8151D
     * (`0x00 PSR` / `0x04 PON` / `0x10 DTM1` / `0x12 DRF` / `0x13 DTM2`) is
     * what `GxEPD2_290_Z13c` emits. `peripherals::kit::registry::TYPE_ALIASES`
     * owns that mapping.
     * @param {Uint8Array} elf_bytes
     */
    install_arduino_esp32_quirks(elf_bytes) {
        const ptr0 = passArray8ToWasm0(elf_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_install_arduino_esp32_quirks(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Clear the IO-Link master's trace ring.
     */
    iolink_trace_clear() {
        wasm.wasmsimulator_iolink_trace_clear(this.__wbg_ptr);
    }
    /**
     * Snapshot of the IO-Link master's captured transactions (oldest→newest),
     * for the IO-Link Analyzer instrument. Empty array if no master is wired.
     * @returns {any}
     */
    iolink_trace_snapshot() {
        const ret = wasm.wasmsimulator_iolink_trace_snapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * Total number of times the browser JIT has dispatched a
     * compiled block. Useful for confirming the JIT path actually
     * fired during a benchmark.
     * @returns {bigint}
     */
    jit_hits() {
        const ret = wasm.wasmsimulator_jit_hits(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Total number of JIT refusals (host bus errors, JS-side
     * dispatch failures). Surfaced for the bench harness so it can
     * distinguish "JIT was tried and rejected" from "JIT was never
     * hit because PC never reached the block".
     * @returns {bigint}
     */
    jit_refusals() {
        const ret = wasm.wasmsimulator_jit_refusals(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Discover the drivable input channels on the running machine, as JSON:
     * `[{"peripheral":"imu","key":"ax","label":"Accel X","unit":"g","min":-16,"max":16}, …]`.
     * `peripheral` is the system.yaml external-device id when stamped (the
     * same name `set_input`'s component selector accepts), else the owning
     * peripheral's bus name. The "what can I drive?" query an agent calls
     * before `set_input`.
     * @returns {any}
     */
    list_inputs() {
        const ret = wasm.wasmsimulator_list_inputs(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * The whole probeable WIRE surface of this chip: every peripheral that
     * publishes wire lines, with the exact line names it publishes.
     *
     * Returns `[{ peripheral, lines: ["TX", "RX"] }]`, bus order.
     *
     * This exists so a probe menu is built from engine truth instead of a
     * second, hand-maintained copy of the vocabulary. The spellings are not
     * uniform and are not derivable from the protocol — generic STM32 SPI
     * publishes `SCK/MOSI/MISO` and NO chip select, RP2040 SPI spells it
     * `CSn`, ESP GPSPI spells it `CS`. Anything that guesses `"CS"` offers a
     * lane that cannot resolve on two of those three.
     * @returns {any}
     */
    logic_wire_surface() {
        const ret = wasm.wasmsimulator_logic_wire_surface(this.__wbg_ptr);
        return ret;
    }
    /**
     * Legacy constructor: hardcoded STM32F107 Cortex-M3 with 128KB flash + 20KB RAM.
     * Kept for backward compatibility with the existing landing page sandbox.
     * @param {Uint8Array} firmware
     */
    constructor(firmware) {
        const ptr0 = passArray8ToWasm0(firmware, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmSimulatorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Config-driven constructor: initialize from system YAML, chip YAML, and firmware ELF.
     *
     * Dispatches on `chip.arch`:
     *   * `Arm` → `SystemBus::from_config` + `configure_cortex_m` (existing path).
     *   * `Xtensa` → `configure_xtensa_esp32` + inline external-device attach.
     *     ESP32 chip YAMLs declare RAM banks (IRAM/DRAM/flash XIP/ROM) via
     *     `peripherals: [{type: ram, ...}]`, which `from_config` doesn't
     *     understand — it'd stub them out and break instruction fetch. So
     *     ESP32 takes the dedicated path that explicitly registers those
     *     banks before attaching SPI / I²C external devices.
     * @param {string} system_yaml
     * @param {string} chip_yaml
     * @param {Uint8Array} firmware
     * @param {any} blobs
     * @returns {WasmSimulator}
     */
    static new_from_config(system_yaml, chip_yaml, firmware, blobs) {
        const ptr0 = passStringToWasm0(system_yaml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(chip_yaml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(firmware, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_new_from_config(ptr0, len0, ptr1, len1, ptr2, len2, blobs);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmSimulator.__wrap(ret[0]);
    }
    /**
     * Raw escape hatch: read `len` bytes at absolute `addr`, side-effect-free.
     * Bytes outside any mapped region read back as `0` here (the honest
     * mapped/unmapped markers live on the core [`labwired_core::Machine::peek`]
     * / the `inspect` payload; this raw byte view is the fast path).
     *
     * Errors when there is no machine at all, rather than handing back an empty
     * buffer: a zero-length read is data-shaped, so a caller that checks
     * `.length` could not tell "nothing is mapped here" from "this simulator
     * never started". The per-byte lossy zero-fill above is unchanged.
     * @param {number} addr
     * @param {number} len
     * @returns {Uint8Array}
     */
    peek(addr, len) {
        const ret = wasm.wasmsimulator_peek(this.__wbg_ptr, addr, len);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Resolve the signal routing of GPIO pads for the logic analyzer — the
     * engine's honest answer to "what is this pad wired to?", replacing UI-side
     * pin-NAME regex guessing.
     *
     * Input: `[{ kind: "gpio", peripheral, pin }]`.
     * Output: the same refs each extended with:
     *   * `mode`: `"input" | "output" | "af" | "analog" | "unknown"` — derived
     *     from the same register truth `read_gpio_pad` reads (STM32 F1 CRL/CRH,
     *     V2 MODER+AFR, ESP32-family GPIO-matrix ENABLE + FUNCn_OUT_SEL, nRF52
     *     DIR, Kinetis PDDR). `"unknown"` where a family cannot say.
     *   * `func`: best-effort signal NAME (`"I2CEXT0_SDA"`, `"FSPICLK"`,
     *     `"AF4"`, …) or `null` — never a guess.
     * @param {any} refs
     * @returns {any}
     */
    pin_routing(refs) {
        const ret = wasm.wasmsimulator_pin_routing(this.__wbg_ptr, refs);
        return ret;
    }
    /**
     * #124 Phase 4: enable/disable the browser-side JIT fast-path. When
     * on, `step_with_esp32_aids` short-circuits any pre-fetch step
     * whose PC matches the JIT'd hot block (`0x400829cc`) into a wasm
     * call constructed via `js_sys::WebAssembly`. Off by default —
     * callers opt in from JS once they've benchmarked.
     * Wall-clock attribution for the open profiling window, as text, with this
     * chip's peripheral names resolved.
     *
     * The window is per-THREAD, not per-simulator: on a multi-chip lab every
     * chip in this worker records into it, and the report says so.
     * @returns {string}
     */
    profile_report() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsimulator_profile_report(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The same attribution as JSON, for a HUD to render.
     * @returns {string}
     */
    profile_report_json() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmsimulator_profile_report_json(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Read logic edges captured since `cursor`. Pass `0` right after
     * [`watch_logic_signals`], then pass back the returned `cursor` to
     * acknowledge those retained edges and receive only newer ones.
     *
     * Returns `{ cursor, dropped, nowCycle, edges: [{ ch, cycle, value }] }`:
     * - `cursor` — monotonic edge sequence number to pass back next time.
     * - `dropped` — edges lost to ring-buffer overflow since the watch armed.
     * - `nowCycle` — current engine cycle, to extend flat traces to "now".
     * - `edges` — transitions oldest-first; `cycle` is the engine cycle.
     *
     * Cycles are emitted as JS numbers (f64), matching the sub-2^53 engine
     * cycle counts the playground runs to.
     * @param {number} cursor
     * @returns {any}
     */
    read_logic_edges(cursor) {
        const ret = wasm.wasmsimulator_read_logic_edges(this.__wbg_ptr, cursor);
        return ret;
    }
    /**
     * Read `len` bytes at `addr` through the real bus read path.
     *
     * Errors rather than substituting `0` for a byte the bus refused. The old
     * `unwrap_or(0)` made a failed read byte-identical to a register or memory
     * cell that genuinely reads zero, and `null`/`0` is exactly the answer a
     * verdict cannot tell apart from data. `WasmWorld::read_memory` has always
     * returned `Result`; this brings the single-machine path to the same
     * contract.
     *
     * Note this fires read side effects (it is a bus read, not a peek) — see
     * [`labwired_core::MachineTrait::read_memory`]. Use `peek`/`inspect` for
     * anything a human is merely looking at.
     * @param {number} addr
     * @param {number} len
     * @returns {Uint8Array}
     */
    read_memory(addr, len) {
        const ret = wasm.wasmsimulator_read_memory(this.__wbg_ptr, addr, len);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The largest `peripheral_tick_interval` this machine's bus can run at
     * without losing fidelity (see `SystemBus::max_safe_tick_interval`): a
     * batching interval when every peripheral is scheduler-driven, `1` when
     * anything non-relaxable (IO-Link master, a live legacy walk, forced
     * HC-SR04 legacy path) is present. H5 op-modeling FLASH still clamps
     * CPU quantum via `requires_cycle_accurate` but does not pin this
     * interval. The TS side calls this once at engine init and feeds the
     * answer straight into `set_peripheral_tick_interval`.
     * @returns {number}
     */
    recommended_tick_interval() {
        const ret = wasm.wasmsimulator_recommended_tick_interval(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Sample the live level of logic-analyzer channels — the per-frame
     * readout beside [`watch_logic_signals`]'s captured waveform. It takes
     * the SAME flat ref surface, both kinds:
     *
     * * `{ kind: "gpio", peripheral, pin }` — the chip pad.
     * * `{ kind: "wire", peripheral, line }` — the peripheral's own line.
     *
     * ⚠️ `pin` is `#[serde(default)]` for a reason a test pins down: a wire
     * ref legitimately carries no `pin`, and a required field made
     * `from_value` fail for the WHOLE array, so one wire lane silently
     * blanked the live readout of every pad lane beside it.
     *
     * Output mirrors each ref, extended with `value: bool | null` — `null`
     * when the level is unknown (missing peripheral, out-of-range pin,
     * unknown line, or a pad handed to a bus controller the GPIO model does
     * not track) — plus an `error` string on a wire ref that could not
     * resolve, so a blank lane says why. Cheap enough to call every frame.
     * @param {any} refs
     * @returns {any}
     */
    sample_logic_signals(refs) {
        const ret = wasm.wasmsimulator_sample_logic_signals(this.__wbg_ptr, refs);
        return ret;
    }
    /**
     * Inject an ADC value into a named ADC peripheral's data register.
     * @param {string} peripheral_name
     * @param {number} value
     */
    set_adc_value(peripheral_name, value) {
        const ptr0 = passStringToWasm0(peripheral_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_set_adc_value(this.__wbg_ptr, ptr0, len0, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Set an input board_io binding (e.g. button press).
     * Writes to the GPIO IDR register bit for the specified binding.
     * @param {string} id
     * @param {boolean} active
     */
    set_board_io_input(id, active) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_set_board_io_input(this.__wbg_ptr, ptr0, len0, active);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Enable/disable scheduler-safe CPU idle fast-forwarding. Off by default;
     * browser callers opt in explicitly after comparing accelerated and
     * non-accelerated traces for the target firmware.
     * @param {boolean} enabled
     */
    set_idle_fast_forward_enabled(enabled) {
        wasm.wasmsimulator_set_idle_fast_forward_enabled(this.__wbg_ptr, enabled);
    }
    /**
     * Generic input-scripting entry point: drive `channel` to `value` (in the
     * channel's engineering unit — g, cm, °C …) on the unique attached input
     * device that exposes it. Type-agnostic (see `labwired_core::sim_input`),
     * so the browser panel, an MCP tool, and a test-script stimulus all share
     * ONE surface. Errors if no device (or more than one) exposes the channel,
     * or the value is out of range.
     * @param {string} channel
     * @param {number} value
     */
    set_input(channel, value) {
        const ptr0 = passStringToWasm0(channel, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_set_input(this.__wbg_ptr, ptr0, len0, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Apply several input sets as ONE atomic transaction. `sets` is a JSON
     * array of `{channel, value, component?}`; every set is validated first
     * and either all apply or none do, with no simulation steps in between —
     * the way to drive a multi-channel pose (an IMU's x/y/z, a GPS lat+lon)
     * without the firmware observing a torn update, especially from a
     * worker-engine bridge where single calls interleave with execution.
     * @param {any} sets
     */
    set_inputs(sets) {
        const ret = wasm.wasmsimulator_set_inputs(this.__wbg_ptr, sets);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {boolean} enabled
     */
    set_jit_enabled(enabled) {
        wasm.wasmsimulator_set_jit_enabled(this.__wbg_ptr, enabled);
    }
    /**
     * Toggle one allowlisted injected motor fault.
     * @param {string} id
     * @param {string} fault
     * @param {boolean} active
     */
    set_motor_fault(id, fault, active) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(fault, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_set_motor_fault(this.__wbg_ptr, ptr0, len0, ptr1, len1, active);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Apply one allowlisted motor-plant input in SI units.
     * @param {string} id
     * @param {string} name
     * @param {number} value
     */
    set_motor_input(id, name, value) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_set_motor_input(this.__wbg_ptr, ptr0, len0, ptr1, len1, value);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Set the simulated temperature on an NTC thermistor.
     *
     * `device_id` is the `external_devices` id (stamped on the kit at attach).
     * Routes through the ONE SimInput path (`temperature` °C → kit → ADC sync).
     * No `board_io` twin required.
     * @param {string} device_id
     * @param {number} temperature_c
     */
    set_ntc_temperature(device_id, temperature_c) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_set_ntc_temperature(this.__wbg_ptr, ptr0, len0, temperature_c);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Set the peripheral tick interval used by `Machine::run`.
     *
     * `1` is the exact default: tick orchestration runs after every executed
     * instruction. Larger values are a bounded browser acceleration knob for
     * firmware bring-up paths whose active peripherals are scheduler-driven or
     * inactive.
     *
     * The machine and bus each hold a `SimulationConfig`; both are updated —
     * the run loop paces ticks off the machine's copy while the legacy-walk
     * quantum (`tick_elapsed(interval)`) and the HC-SR04 event-scheduling
     * gate read the bus's, and they must agree or walked peripherals run
     * `interval`× slow.
     * @param {number} interval
     */
    set_peripheral_tick_interval(interval) {
        wasm.wasmsimulator_set_peripheral_tick_interval(this.__wbg_ptr, interval);
    }
    /**
     * Set the simulated wiper position on a potentiometer kit.
     *
     * Thin wrapper over [`Machine::set_input_on`] — identity is the
     * `external_devices` id (no board_io twin). Kit math drives the ADC.
     * `position_pct` must be in 0..=100.
     * @param {string} device_id
     * @param {number} position_pct
     */
    set_potentiometer(device_id, position_pct) {
        const ptr0 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmsimulator_set_potentiometer(this.__wbg_ptr, ptr0, len0, position_pct);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {number} cycles
     */
    step(cycles) {
        const ret = wasm.wasmsimulator_step(this.__wbg_ptr, cycles);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Execute up to max_cycles steps, returning the number actually executed.
     * @param {number} max_cycles
     * @returns {number}
     */
    step_batch(max_cycles) {
        const ret = wasm.wasmsimulator_step_batch(this.__wbg_ptr, max_cycles);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * Execute one measured batch and return both wall-clock timing and core
     * run-loop counters. Intended for worker/Playwright profiling; normal
     * animation still calls `step_batch`.
     * @param {number} max_cycles
     * @returns {any}
     */
    step_batch_profile(max_cycles) {
        const ret = wasm.wasmsimulator_step_batch_profile(this.__wbg_ptr, max_cycles);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    step_single() {
        const ret = wasm.wasmsimulator_step_single(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Step `cycles` cycles with the ESP32-classic IPI bridge active. Each
     * cycle samples the DPORT FROM_CPU intmatrix mapping and trigger
     * registers, raises the corresponding INTERRUPT bit, and clears the
     * trigger so the next write re-edges. The dual-core handshake bytes
     * are re-applied every 10k cycles (matching the e2e test cadence).
     * Falls back to plain `step` if `install_esp32_arduino_quirks` hasn't
     * been called yet.
     *
     * Dual-core machines use batched [`AdvanceRequest::run`] (same as
     * [`Self::step_batch`]) so idle fast-forward can engage while PRO_CPU is
     * WAITI-parked. The old N× `AdvanceRequest::single` path forced quantum-1
     * and permanently disabled idle FF for the classic-aids playground path.
     * @param {number} cycles
     */
    step_with_esp32_aids(cycles) {
        const ret = wasm.wasmsimulator_step_with_esp32_aids(this.__wbg_ptr, cycles);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Capture the current machine state as a binary `MachineRuntimeSnapshot`
     * (LWRS-framed bincode blob). Mirror of `apply_runtime_snapshot` —
     * returned bytes can be fed back to `apply_runtime_snapshot` on a fresh
     * `WasmSimulator` with the same firmware + bus topology.
     * @returns {Uint8Array}
     */
    take_runtime_snapshot() {
        const ret = wasm.wasmsimulator_take_runtime_snapshot(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Non-consuming UART trace snapshot for instruments such as the logic analyzer.
     *
     * Reads the machine's ONE bus trace and groups by bus name. It does NOT
     * walk peripherals looking for a concrete type, and that is the whole
     * point: this used to be `downcast_ref::<Uart>()`, which silently found
     * only the generic STM32-family model. `EspUart` (ESP32-C3 / ESP32-S3),
     * `Esp32Uart`, `Nrf52Uarte` and `Nrf54lUarte` are all UARTs and none of
     * them is a `Uart`, so on every ESP and nRF lab this returned `[]` — the
     * analyzer's UART panel sat empty forever with nothing to indicate an
     * error. Asking the trace what it recorded, rather than asking the type
     * system what a UART is, is what makes the answer complete.
     * @returns {any}
     */
    uart_trace_snapshot() {
        const ret = wasm.wasmsimulator_uart_trace_snapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * Raw bytes the firmware wrote to the console this board's USB connector is
     * not wired to. Empty when there are none. Diagnostic only — these bytes
     * are deliberately NOT merged into the Serial pane, because no real board
     * would have delivered them.
     * @returns {Uint8Array}
     */
    unheard_console_output() {
        const ret = wasm.wasmsimulator_unheard_console_output(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Arm deterministic, in-engine logic-analyzer capture. TWO channel kinds,
     * one capture layer — same ring, same cursor, same [`read_logic_edges`],
     * same decoders. The ref surface is FLAT:
     *
     * * `{ kind: "gpio", peripheral, pin }` — a chip PAD. Reads what a probe
     *   clipped to that pin would see and nothing else. An unmuxed pad reads
     *   the GPIO output latch and draws a flat line; it NEVER falls back to
     *   the owning peripheral's wire, because a pad probe that quietly showed
     *   bus traffic on a pin no bus reaches would hide the commonest serial
     *   bring-up bug there is.
     * * `{ kind: "wire", peripheral, line }` — a peripheral's OWN line, by
     *   name: `{ kind: "wire", peripheral: "usart2", line: "TX" }`. Line names
     *   are the datasheet role labels (`"TX"`/`"RX"`, `"SCL"`/`"SDA"`,
     *   `"SCK"`/`"MOSI"`/…), matched ignoring case. Independent of pad muxing,
     *   of alternate-function tables, and of which instances a family's pad
     *   table happens to cover.
     *
     * Each ref is resolved ONCE here (to a peripheral index plus a pin or a
     * line index) so the in-loop sampling path never does a string lookup.
     * An unresolvable ref gets `value: null`, an `error` string saying why,
     * and is never sampled — it is not silently dropped and never falls
     * through to channel zero. Installing a watch set resets the capture ring
     * and cursor.
     *
     * Returns the initial state as `[{ ...ref, ch, value }]` where `ch` is the
     * channel index used in edge records (the ref's position) and `value` is
     * the current level (`bool | null`). A `gpio` row carries `pin`, a `wire`
     * row carries `line`. Poll new edges with [`read_logic_edges`]. Pass an
     * empty array to disarm capture.
     * @param {any} refs
     * @returns {any}
     */
    watch_logic_signals(refs) {
        const ret = wasm.wasmsimulator_watch_logic_signals(this.__wbg_ptr, refs);
        return ret;
    }
    /**
     * Non-consuming WiFi 802.11 frame-trace snapshot for the network analyzer
     * (the WiFi analog of `air_trace_snapshot`). Returns, per ESP32-C3 WiFi MAC,
     * the recently captured TX/RX frames (most-recent first); the analyzer UI
     * decodes 802.11 type/addresses and the L3 payload (DHCP/ARP/IP).
     * @returns {any}
     */
    wifi_trace_snapshot() {
        const ret = wasm.wasmsimulator_wifi_trace_snapshot(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) WasmSimulator.prototype[Symbol.dispose] = WasmSimulator.prototype.free;
exports.WasmSimulator = WasmSimulator;

class WasmWorld {
    static __wrap(ptr) {
        const obj = Object.create(WasmWorld.prototype);
        obj.__wbg_ptr = ptr;
        WasmWorldFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmWorldFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmworld_free(ptr, 0);
    }
    /**
     * @returns {any}
     */
    air_trace_snapshot() {
        const ret = wasm.wasmworld_air_trace_snapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {string} node_id
     * @returns {any}
     */
    bus_trace_snapshot(node_id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_bus_trace_snapshot(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} node_id
     * @returns {Uint8Array}
     */
    drain_uart_output(node_id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_drain_uart_output(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * @param {string} node_id
     * @returns {any}
     */
    fdcan_trace_snapshot(node_id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_fdcan_trace_snapshot(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} node_id
     * @returns {number}
     */
    get_pc(node_id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_get_pc(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {string} node_id
     * @param {number} id
     * @returns {number}
     */
    get_register(node_id, id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_get_register(this.__wbg_ptr, ptr0, len0, id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * @param {string} node_id
     * @returns {any}
     */
    get_register_names(node_id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_get_register_names(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} node_id
     * @param {string} device_id
     * @returns {Uint8Array}
     */
    get_ssd1306_framebuffer(node_id, device_id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(device_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_get_ssd1306_framebuffer(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v3;
    }
    /**
     * @param {string} environment_yaml
     * @param {any} nodes
     * @returns {WasmWorld}
     */
    static new_from_resolved(environment_yaml, nodes) {
        const ptr0 = passStringToWasm0(environment_yaml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_new_from_resolved(ptr0, len0, nodes);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return WasmWorld.__wrap(ret[0]);
    }
    /**
     * @returns {any}
     */
    node_ids() {
        const ret = wasm.wasmworld_node_ids(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {string} node_id
     * @returns {any}
     */
    node_snapshot(node_id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_node_snapshot(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} node_id
     * @param {number} address
     * @param {number} len
     * @returns {Uint8Array}
     */
    read_memory(node_id, address, len) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_read_memory(this.__wbg_ptr, ptr0, len0, address, len);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * @param {string} node_id
     * @param {number} address
     * @returns {number}
     */
    read_u8(node_id, address) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_read_u8(this.__wbg_ptr, ptr0, len0, address);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0];
    }
    /**
     * @param {number} rounds
     * @returns {number}
     */
    step_batch(rounds) {
        const ret = wasm.wasmworld_step_batch(this.__wbg_ptr, rounds);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    step_single() {
        const ret = wasm.wasmworld_step_single(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {string} node_id
     * @returns {bigint}
     */
    total_cycles(node_id) {
        const ptr0 = passStringToWasm0(node_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmworld_total_cycles(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
}
if (Symbol.dispose) WasmWorld.prototype[Symbol.dispose] = WasmWorld.prototype.free;
exports.WasmWorld = WasmWorld;

/**
 * A shared UART cross-link medium, owned by the host. Create one per multi-chip
 * lab-group and pass it to every chip's `attach_uart_wire`; chips sharing a bus
 * exchange bytes, chips on different buses are isolated. A fresh `WireBus` per
 * lab (re)load replaces the former module-global reset — a new bus starts empty,
 * so no stale link buffers can leak into the new station.
 */
class WireBus {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WireBusFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wirebus_free(ptr, 0);
    }
    /**
     * Drop every link's buffered bytes on this bus. Rarely needed — prefer a
     * fresh `WireBus` per lab load — but exposed for in-place resets.
     */
    clear() {
        wasm.wirebus_clear(this.__wbg_ptr);
    }
    constructor() {
        const ret = wasm.wirebus_new();
        this.__wbg_ptr = ret;
        WireBusFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WireBus.prototype[Symbol.dispose] = WireBus.prototype.free;
exports.WireBus = WireBus;

/**
 * Is the engine profiler recording?
 * @returns {boolean}
 */
function profile_enabled() {
    const ret = wasm.profile_enabled();
    return ret !== 0;
}
exports.profile_enabled = profile_enabled;

/**
 * Start an engine profiling window in the browser, installing the
 * `performance.now()` clock. Without this the wasm build has no clock at all
 * and every duration would read zero — see `labwired_core::profile`.
 */
function profile_start() {
    wasm.profile_start();
}
exports.profile_start = profile_start;

/**
 * Close the profiling window. The report survives until the next
 * [`profile_start`].
 */
function profile_stop() {
    wasm.profile_stop();
}
exports.profile_stop = profile_stop;

/**
 * Inject the JSON body the virtual WiFi AP serves for
 * `GET /v1/public-stats` (LBC3.1 stats lab). The browser playground should
 * `fetch('https://api.labwired.com/v1/public-stats')` and pass the text here
 * **before** constructing the simulator so the device twin receives live
 * product numbers. Pass an empty string to clear the override (baked
 * fallback). Wasm has no sockets; native CLI fetches live itself.
 * @param {string} json
 */
function set_wifi_ap_public_stats_json(json) {
    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.set_wifi_ap_public_stats_json(ptr0, len0);
}
exports.set_wifi_ap_public_stats_json = set_wifi_ap_public_stats_json;

/**
 * Fulfill a DNS request with A records. `ips_json` is a JSON array of
 * dotted-quads, e.g. `["93.184.216.34"]`.
 * @param {number} id
 * @param {string} ips_json
 */
function wifi_host_fulfill_dns(id, ips_json) {
    const ptr0 = passStringToWasm0(ips_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.wifi_host_fulfill_dns(id, ptr0, len0);
}
exports.wifi_host_fulfill_dns = wifi_host_fulfill_dns;

/**
 * Fulfill an HTTP proxy request with a raw HTTP/1.1 response body (status
 * line + headers + body), as UTF-8 or binary string via byte array from JS.
 * @param {number} id
 * @param {Uint8Array} response
 */
function wifi_host_fulfill_http(id, response) {
    const ptr0 = passArray8ToWasm0(response, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.wifi_host_fulfill_http(id, ptr0, len0);
}
exports.wifi_host_fulfill_http = wifi_host_fulfill_http;

/**
 * Enable browser host-network bridge so the virtual AP grants stations
 * internet via JS (DoH + `fetch`). Call once after loading the wasm module.
 * @param {boolean} active
 */
function wifi_host_net_set_active(active) {
    wasm.wifi_host_net_set_active(active);
}
exports.wifi_host_net_set_active = wifi_host_net_set_active;

/**
 * Pending DNS names the host must resolve (DoH). JSON array of
 * `{ "id": number, "name": string }`.
 * @returns {string}
 */
function wifi_host_poll_dns_requests() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wifi_host_poll_dns_requests();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wifi_host_poll_dns_requests = wifi_host_poll_dns_requests;

/**
 * Pending HTTP proxy requests. JSON array of
 * `{ "id", "url", "method", "body_b64" }` — any host URL; body is the
 * request entity after headers (client-side `fetch` uses the user's network).
 * @returns {string}
 */
function wifi_host_poll_http_requests() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.wifi_host_poll_http_requests();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.wifi_host_poll_http_requests = wifi_host_poll_http_requests;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_bce6d499ff0a4aff: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_b7972a139bfbfdf0: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_boolean_get_2304fb8c853028c8: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_edece8177ad01481: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_07056af4f902c445: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_2042690d351e14f0: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_b4593df85baada48: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_dde0fd9020db4434: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_0ad77b7717db155c: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_f73a1244370fcc2c: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_d109740c0d18f4d7: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_3fa391f3fcdb55f8: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_call_084ee3e860ee9f92: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.call(arg1, arg2, arg3, arg4);
            return ret;
        }, arguments); },
        __wbg_call_13665d9f14390edc: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_done_54b8da57023b7ed2: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_564a7e8b1e54ede5: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_exports_fcb6c7dbab2808fc: function(arg0) {
            const ret = arg0.exports;
            return ret;
        },
        __wbg_get_3e9a707ab7d352eb: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_98fdf51d029a75eb: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_dcf82ab8aad1a593: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_unchecked_1dfe6d05ad91d9b7: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
            const ret = arg0[arg1];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_53db37b06f6b9afe: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Object_03924e0dbda74bd8: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Object;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_abd07d4bd221d50b: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_94898ed3aad6947b: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_01e964d144ad3a55: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_iterator_1441b47f341dc34f: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_2591a0f4f659a55c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_56fcd3e2b7e0299d: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_02d162bc6cf02f60: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_070df68d66325372: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_1f0e50fc5628cc27: function() { return handleError(function (arg0) {
            const ret = new WebAssembly.Module(arg0);
            return ret;
        }, arguments); },
        __wbg_new_22cc98ecc9876bce: function() { return handleError(function (arg0, arg1) {
            const ret = new WebAssembly.Instance(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_new_310879b66b6e95e1: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_7ddec6de44ff8f5d: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_with_length_99887c91eae4abab: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_next_2a4e19f4f5083b0f: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_6429a146bf756f93: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_now_062365a429906ed3: function() {
            const ret = performance.now();
            return ret;
        },
        __wbg_prototypesetcall_5f9bdc8d75e07276: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_set_24d0fa9e104112f9: function(arg0, arg1, arg2) {
            arg0.set(getArrayU8FromWasm0(arg1, arg2));
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_78ea6a19f4818587: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_a0e911be3da02782: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_facb7a5914e0fa39: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_value_9cc0518af87a489c: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbg_warn_2519e3d4d14aa367: function(arg0, arg1) {
            console.warn(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [I32], shim_idx: 6973, ret: I32, inner_ret: Some(I32) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h2dec003abc285448);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./labwired_wasm_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__h2dec003abc285448(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h2dec003abc285448(arg0, arg1, arg2);
    return ret;
}

const AirBusFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_airbus_free(ptr, 1));
const WasmSimulatorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmsimulator_free(ptr, 1));
const WasmWorldFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmworld_free(ptr, 1));
const WireBusFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wirebus_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/labwired_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
