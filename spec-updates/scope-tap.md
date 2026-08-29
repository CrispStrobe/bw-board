# Scope-grade probe tap — API proposal

## Problem

Today's probes (board.js:296-339) are voltage-only, sampled once per `advanceTo` call,
with no cadence guarantee. A scope UI needs:

1. **Fixed sample cadence** in sim-time so the timebase is meaningful.
2. **Min/max decimation** so narrow PWM pulses stay visible at any timebase.
3. **Current channels** (not just voltage) for power analysis.
4. **Enough metadata** for edge triggering in the UI.

## Proposed API

### Configuration

```js
// Attach a scope channel. Returns a channel handle (number).
const ch = board.addScopeChannel({
  type: 'voltage',       // 'voltage' | 'current'
  // For voltage: which net
  netId: 'net_led',
  // For current: which part and terminal
  // partId: 'LED1', terminal: 'anode',
  sampleRateHz: 100_000, // sim-time sample rate, default 100 kHz
  depth: 8192,           // ring buffer depth in (min,max) pairs, default 8192
});

// Remove a channel
board.removeScopeChannel(ch);

// Remove all channels
board.clearScopeChannels();
```

### Sampling (inside advanceTo)

When `advanceTo(tNs)` spans N sample points at the configured rate, the engine
sub-samples at each point. Each bucket stores a **(min, max)** voltage/current pair
so that narrow pulses are never lost. When the ring buffer is full, oldest entries
are overwritten.

For current channels: uses the existing `branchCurrent` path, cache-aware. The MNA
cache is invalidated once per sample point (not per edge), so the cost is paid only
while a current probe exists. At 100 kHz sim-time and 60 Hz display rate, that is
~1667 MNA solves per display frame — within budget at 12K solves/sec real-time if
the sim runs at 1x or slower (which it does under scope load).

### Reading

```js
// Get the waveform for a channel.
// Returns { samples, startTNs, sampleIntervalNs }
const wave = board.getScopeData(ch);

// wave.samples: Float64Array of interleaved [min0, max0, min1, max1, ...]
//   Length = depth * 2. Newest sample at the write cursor.
// wave.startTNs: bigint — sim-time of the oldest sample in the buffer
// wave.sampleIntervalNs: bigint — interval between samples
// wave.writeIndex: number — index of the next write position (for ring logic)
// wave.channelType: 'voltage' | 'current'
```

The UI can:
- Compute time axis: `t[i] = startTNs + i * sampleIntervalNs`
- Find edges: scan for `max[i] > threshold && min[i+1] < threshold` (or vice versa)
- Draw min/max envelope at any zoom level without re-sampling

### Why interleaved Float64Array

- A typed array is 8x more compact than an array of objects.
- Interleaved (min,max) keeps locality: one cache line per sample point.
- The UI can draw directly from this without transformation.
- Ring buffer semantics: the engine writes at `writeIndex`, the UI reads the
  whole buffer and interprets wrap-around.

### Why (min, max) pairs

A 50% duty PWM at 1 kHz sampled at 100 kHz gives 50 samples per half-cycle.
At a UI zoom of 10ms/div the scope shows 100 cycles. Without min/max, decimating
to screen resolution (say 1000 pixels) loses the pulse edges entirely. With min/max,
each pixel column draws from min to max, preserving the visual envelope.

### Impact on existing API

The existing `addProbe`/`getProbeData`/`removeProbe` API is preserved as-is for
backward compatibility. The scope channels are a separate, parallel system:

- `addProbe` → simple, one-sample-per-advanceTo, good for scripts and tests
- `addScopeChannel` → fixed cadence, decimation, good for scope UI

### Current channel cost model

| Display rate | Sim sample rate | MNA solves/frame | Budget (12K/s) | Margin |
|-------------|----------------|-----------------|---------------|--------|
| 60 Hz       | 100 kHz        | 1667            | 200           | 0.12x  |

This is too expensive per frame at 1x sim speed. The solution: current channels
sample at **display rate** (the same principle as meter blocks), not at sim-time
cadence. The voltage envelope captures the waveform shape; the current is sampled
once per display frame and shown as a separate trace or readout.

Revised: current channels use a different cadence — triggered by an explicit
`sampleCurrentChannels()` call from the display loop, not from `advanceTo`.

```js
// Called from the display loop (~60 Hz). Samples all current channels once.
// Returns Map<channelHandle, number> — instantaneous current per channel.
board.sampleCurrentChannels();
```

### What the engine guarantees, what the UI does

Engine guarantees:
- Fixed cadence in sim-time for voltage channels
- (min, max) decimation preserving pulse edges
- Ring buffer depth and wrap semantics
- Current sampling on demand

UI does (not engine's job):
- Edge triggering (scan the buffer for threshold crossings)
- Timebase zoom (select a window within the ring buffer)
- Channel display (color, scale, position)
- Trigger holdoff

## Addendum (E4.2): digital channels — transitions, not envelopes

`addScopeChannel({type: 'digital', netId, threshold?, depth?})` records
(t, level) TRANSITIONS instead of sampled (min,max) pairs: the level is
`v > threshold` (threshold defaults to vcc/2, captured at add time), and
a write happens only when the level CHANGES. Storage is an interleaved
ring `[tNs, level, ...]` (Float64Array, depth transitions, default
4096, NaN = unwritten), returned by `getScopeData` as `{transitions,
writeIndex, count, depth, threshold, channelType: 'digital'}`.

Why this is exact rather than sampled: E4.1 makes every source edge and
scheduled gate flip a solve point (step barriers + the 1 ns BE seed), and
digital channels are fed at every accepted sub-step and every
instantaneous solve — so a transition's timestamp is the sim-time of the
solve that produced it, not a bucket boundary. A quiet net costs nothing
however long the run; a fixpoint double-flip at one instant records both
transitions, honestly.

The UI's half stays the UI's: rendering the staircase, aligning multiple
channels, bus grouping, protocol decode (bw-circuit-ui X2.5).

## Addendum (bw-circuit-ui D24 / X2.2): `capture: 'sample'` — a series, not an envelope

`addScopeChannel({type: 'voltage', …, capture: 'sample'})` records the
value AT each sample instant into both slots of the pair, instead of the
(min, max) of everything that happened inside the bucket. `getScopeData`
returns `capture: 'envelope' | 'sample'` so a consumer can ASK rather
than assume. The default is unchanged and every existing channel keeps
the envelope, which is the right thing for DRAWING — it is what keeps a
narrow pulse visible at a coarse timebase.

Why a second mode rather than a reinterpretation of the first: an
envelope pair's two numbers are two DIFFERENT INSTANTS reported as one.
A transform over them describes a waveform that never existed, and it
looks plausible, which is worse than looking wrong. Measured on a 1 kHz
sine at 50 kHz capture, 100 of 250 pairs carried min ≠ max, the widest
spanning 0.63 V — and nothing in the buffer says which pairs those are.

Three details that are the whole difference between working and nearly
working, each found by disagreeing with the closed form
`2.5 + 2·sin(2π·1000·t)`:

1. **The value is interpolated, not held.** Taking the solve that lands
   at or after the sample instant is a zero-order hold whose time error
   is a whole solve step: 618 mV of a 2 V amplitude, because the
   transient controller was stepping 50 µs. Linear interpolation between
   the two solves that bracket the instant costs no extra solves and
   brings the same bench to 128 mV.
2. **The integrator step is capped at the finest sample-series
   interval.** With 100 µs steps against a 10 µs grid, nine samples in
   ten came off one line segment. Capping brings the deviation under
   1 mV. ONLY channels that opt in pay this: an envelope channel's cost
   is unchanged, which matters because every existing bench uses one.
3. **`startTNs` is the first SAMPLE's instant, not the first bucket's
   start.** Those differ by one interval. Getting it wrong reads the
   whole series one sample early, which looks exactly like an amplitude
   error — 126 mV of disagreement with the closed form, from an index.

A `type: 'current'` channel now reports `capture: 'sample'`, because
`sampleCurrentChannels()` has always written one instantaneous reading
into both slots. That is a statement of what was already true.

Consumer: bw-circuit-ui `src/model/fft.js` refuses an envelope buffer by
name rather than averaging it into a plausible fake.
