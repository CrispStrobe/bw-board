# Bounded LabWired engineering-input boundary

`createLabwiredAdapter` exposes `discoverInputs()` and `setInputs(sets)`.
Discovery returns the engine's channel metadata with serde Maps normalized to
plain objects; a missing API is an explicit error, not an empty device list.
Each row is `{channel, value, component?}` in the discovered engineering unit.
`component` is the system manifest's external-device id, not a channel prefix.
The two motion devices both expose `x/y/z`, so a pose must identify each device:

```js
adapter.setInputs([
    {component: 'accelerometer', channel: 'x', value: 1},
    {component: 'magnetometer', channel: 'x', value: 30}
]);
```

This example needs those explicitly selected devices attached; this change
does **not** attach them, upgrade the engine or make a motion UI. Unscoped
channels remain available when the backend finds exactly one matching device.
The adapter validates every row's shape and finite numeric value before making
one `set_inputs` call. Device identity, units/ranges and application atomicity
remain the engine's contract. Unknown fields, sparse arrays and malformed rows
are refused. There is no sequential `set_input` fallback on older backends.
Successful writes return copied applied rows; they retire no guest instruction.

The LabWired debug target forwards discovery and writes through the adapter.
Successful writes emit one `labwired.inputs` input fact with copied rows and
instruction-clock time; rejected writes emit none. Firmware-only replay uses
the same atomic route without emitting a second live fact. Circuit sessions
continue to refuse replay because the external board cannot be rewound; a
detached target refuses scoped inputs. This is a debugger boundary, not a
new private Lite worker request or UI control.

## Evidence and limits

`test/labwired-input-boundary.test.mjs` explicitly separates seven JS
call-contract tests using backend doubles from four **actual WASM** tests.
The latter attach two real potentiometer kits, discover scoped identities,
read the engine's ADC input state, and prove that ambiguous ids, unknown ids
and a bad later range change neither component. They also exercise the real
debug input receipt/replay path. They qualify generic held engineering inputs,
not LSM303AGR, ADC silicon fidelity, an executing guest, browser rendering or
throughput. The published WEB module is instantiated under Node for this proof.

The four real tests ran without skips against published release
`labwired-wasm-0c0cd0ec` (source `0c0cd0ec3f10c5b291a2bf53705df5cd09765728`):

- Original WEB glue asset 537128705, SHA256
  `a25e1e596ae1afb97e946b9658e466b907908e1f36fb32e9cfb00c0ac0dd848f`.
- Original WASM asset 537128700, SHA256
  `ea1e375ae2f29decc2dbf5774f0266ab6d9343fdd5213066f7dba58e98db0a47`.

Both hashes matched GitHub's published asset digests; the existing deployed
WASM bytes were reused, and only the small original glue was downloaded.
No artifact was built, published or promoted. The current BW engine pin and
Lite package pins are unchanged, and this result does not qualify the newer
native CP13 composition. The input-boundary and existing target-surface run
passed all 56 tests with zero failures or skips. The separate replay-surface
conformance run passed all 46 tests with zero failures or skips, using the
existing installed `avr8js` 0.21.0 via a temporary Node resolver (no dependency
installation or checkout changes). Another 25 non-engine bridge/matrix
regressions passed; that run does not claim engine-dependent matrix coverage.

Run the real proof with either the existing `LABWIRED_WASM` NODEJS directory
or both `LABWIRED_INPUT_WEB_GLUE` and `LABWIRED_INPUT_WEB_WASM` file paths.
Absent an artifact the four tests skip explicitly; those skips are not passes.
The existing two-runner WASM publication workflow selects this file against its
fresh NODEJS build and retains its zero-skips gate.

Next separate work remains selected-board device attachment, actual Lite
worker/UI routing and browser guest/performance qualification, then verified
artifact promotion. Shared sensor IRQ and timed microphone/audio are untouched.
