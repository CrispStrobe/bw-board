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
