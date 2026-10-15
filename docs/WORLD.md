# The simulated world

One **world** per project holds the ambient conditions every sensor reads.
Source: `src/world.js`. Tests: `test/world.test.mjs`, `test/stimulus.test.js`.

## Values

| key | unit | default | notes |
| --- | --- | --- | --- |
| `temperatureC` | °C | 25 | the bench temperature (was `board.temperatureC`); range −55…150 |
| `humidityPct` | % RH | 50 | 0…100 |
| `pressureHpa` | hPa | 1013.25 | 300…1100 |
| `lightLux` | lx | unset | 0…120 000 |
| `soundDb` | dB SPL | unset | 0…140 |

The three set defaults equal the fallbacks the sensor models always used, so a
project that never touches the world reads exactly what it read before. Light
and sound start **unset**: those parts each had their own fallback (a BH1750
read 0 lx, a TEMT6000-style module 0.5, a solar cell full light), and while the
world key is unset every part keeps its own fallback.

Values are clamped to the range; non-finite input is ignored.

## API

```js
import { createWorld, World } from './src/world.js';
const world = createWorld();              // or board.world (each board has one)
world.get('temperatureC', tSec);          // null for an unset light/sound
world.set('humidityPct', 70);             // clears a schedule; null resets
world.setSchedule('temperatureC', [[0, 20], [60, 30]]);
const off = world.subscribe((key, value) => {});
world.toJSON();                           // only non-defaults; {} when untouched
World.fromJSON(obj);
board.setWorld(world);                    // share one world between boards
board.setTemperature(c);                  // = board.world.set('temperatureC', c)
```

**Schedules** are piecewise-linear in *simulation* seconds (`board.timeNs`),
held flat before the first and after the last point. No wall clock is read, so
runs are deterministic. A circuit (MNA) quantity that depends on temperature is
recomputed at the next solve, not exactly at a schedule breakpoint; device
models (DHT, BMP280 …) read the world each time the firmware reads them.

## Precedence

1. An explicit per-part value: `part.params[param]`, set by the netlist, the
   Environment block *set [PARAM] of [PART] to [VALUE]* or the controller panel.
   It always wins, as before.
2. The world value at the board's simulation time.
3. The part model's own fallback.

Which part params read the world (`WORLD_PARAM_BINDINGS`):

| param | world key | conversion | parts |
| --- | --- | --- | --- |
| `temperature` | temperatureC | — | DHT11/22, DS18B20, DS3231, MPU6050, BMP280, other models reading `params.temperature` |
| `humidity` | humidityPct | — | DHT11/22 |
| `pressure` | pressureHpa | ×100 → Pa | BMP/BME pressure sensors only (not touch-controller pressure) |
| `lux`, `white` | lightLux | — | BH1750, VEML7700 |
| `light` | lightLux | `log10(1+lx)/5`, clamped 0…1 (100 000 lx → 1) | ambient-light module, photodiode, phototransistor, solar cell |
| `level` | soundDb | `(dB−30)/90`, clamped 0…1 | sound module only |

The TMP36-style `temp_sensor`, every junction's temperature coefficient (MNA)
and every chip's internal temperature sensor (`benchCelsius` in
`src/chip-temperature.js`: ATmega/ATtiny, RP2040, STM32F030) read
`board.temperatureC`, which is the world's `temperatureC`.

## Several boards

Each new board has its own world, so a one-board project is self-contained.
A project with several boards creates one world and calls `setWorld` on every
board; a change through any board (or the world) re-solves and notifies all of
them (`'temperature'` change event for temperature, `'world'` for the rest).

## Blocks

The Environment extension adds *set world [KEY] to [VALUE]* and the reporter
*world [KEY]*. The part reporter *[PARAM] of [PART]* now reports the value the
part actually reads (its own stimulus, else the world).

## Persistence

`world.toJSON()` writes only what differs from the defaults and an untouched
world serialises to `{}`, so a host (Brickwright Lite) can omit it and leave
existing project files byte-for-byte unchanged.

## Limits

- The basic `ldr` and `thermistor` parts are *controls* (a 0…1 slider in
  `board.controls`), not params; they do not follow the world yet.
- The world is uniform in step 1: no position, no sources (see step 2).
- The light/sound normalisations are documented conventions, not calibrated
  sensor responses.
