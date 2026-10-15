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

## Positions and sources (step 2)

**Positions.** A part's bench position is the circuit designer's own layout
coordinate. The engine netlist carries no layout, so the host hands it over:
`board.setPartPositions({id: {x, y}})`; a netlist part with finite `x`/`y` is
used when the host gives nothing. `board.setBenchOrigin(x, y)` places a whole
board on the shared bench, so several boards laid out side by side share one
coordinate frame. A part with no position reads the uniform world, exactly as
in step 1.

**Sources** are world objects, not circuit parts (nothing to wire, and no
designer change is needed):

```js
world.setSource({id: 'h1', kind: 'heater', x: 100, y: 40, strength: 10, radius: 100, on: true});
world.removeSource('h1');
world.getSources();
world.getAt('temperatureC', x, y, tSec);
```

| kind | world key | effect | default strength |
| --- | --- | --- | --- |
| `heater` | temperatureC | + strength °C | 10 |
| `fan` | temperatureC | − strength °C | 3 |
| `lamp` | lightLux | + strength lx | 500 |
| `sound` | soundDb | a source of strength dB SPL | 80 |

**Falloff** (`falloff(d, radius)`): 1 at or inside `radius` (default
`REFERENCE_DISTANCE` = 100 layout units, about one part's width), and
`(radius/d)²` beyond — inverse-square, clamped so a sensor on top of a source
stays finite. The value at a point is the uniform (ambient, possibly
scheduled) value plus `sign · strength · falloff` for every switched-on source
of that key; an unset light starts from 0 lx. Sound levels combine as
intensities: `L = 10·log10(10^(L_amb/10) + Σ 10^(L_i/10) · falloff)`, i.e.
−6 dB per doubling of distance beyond the radius and +3 dB for two equal
sources. Results are clamped to the key's range. Everything is a pure function
of positions, strengths and simulation time: deterministic.

**Precedence** is unchanged: a part's own value wins; then the positioned
world value; then the model's fallback. Sources persist in `toJSON()` as
`sources: [...]`; a world without sources writes nothing extra.

## Limits

- The basic `ldr` and `thermistor` parts are *controls* (a 0…1 slider in
  `board.controls`), not params; they do not follow the world yet.
- Sources are a documented first-order model (no walls, no convection or
  thermal time constant; a heater acts instantly). Chip die temperature
  (`benchCelsius`) reads the uniform world, not the chip's position.
- The light/sound normalisations are documented conventions, not calibrated
  sensor responses.
