"""Independent exact device golden for the authored no-I/O AT loop (paired-v3).

Stdlib only; imports nothing from the producer and never reads a child's
output. It replays, from the declared source semantics alone, the deferred
chip-debt scheduler of src/i8086-machine.js (step/_flushChips/_wakeHorizon,
deadline batching) together with the four time-driven chips of the 386 AT
profile, using the same IEEE-754 double operation order the JS uses:

  * I8254 (src/i8254.js, advanceMs): the machine converts n clocks to
    ms = n*1000/clockHz and the PIT carries exact = ms*1193182/1000 + frac,
    frac = exact - floor(exact). With every counter null-count (no I/O) its
    wake is Infinity.
  * MC146818 (src/mc146818.js): cyclePhase += n with one update per clockHz
    (register C bit 0x10); register A 0x26 -> 1024 Hz periodic phase
    += n*1024, reduced mod clockHz with bit 0x40. Register B 0x02 masks PIE,
    so the wake is clockHz - cyclePhase. Alarm registers stay 0 and the
    seconds count after a few updates is never 0, so bit 0x20 never rises.
  * CGACard (src/cga-card.js): wake = ACTIVE-pos or FRAME-pos.
  * AT8042A20 (src/at-8042-a20.js): power-on BAT 0xAA after 4,200,000
    clocks; command byte 0 leaves the schedule unmasked; wake = remaining.
  * UPD765: no I/O, wake Infinity.

Every completed instruction is charged functionalInstructionCycles = 6.
A flush happens at the start of a step whose entry debt >= deadline.
"""
import math

CLOCK_HZ = 16_000_000
PIT_HZ = 1_193_182
CAP = round(CLOCK_HZ / 1000)
FRAME = round(CLOCK_HZ / 60)
ACTIVE = round(FRAME * 200 / 262)
RTC_HZ = 32768 >> (0x26 % 16 - 1)
BAT = 4_200_000
CHARGE = 6


def derive(steps):
    if not (isinstance(steps, int) and steps >= 0):
        raise ValueError('steps domain')
    applied = 0
    frac = 0.0
    debt = 0
    deadline = 0
    rtc_cycle = rtc_periodic = reg_c = updates = 0
    kb_remaining, kb_scheduled, kb_queue = BAT, True, []
    done = 0

    def flush(n):
        nonlocal applied, frac, rtc_cycle, rtc_periodic, reg_c, updates, kb_remaining, kb_scheduled
        if n <= 0:
            return
        ms = n * 1000 / CLOCK_HZ
        exact = (ms * PIT_HZ / 1000) + frac
        frac = exact - math.floor(exact)
        rtc_cycle += n
        while rtc_cycle >= CLOCK_HZ:
            rtc_cycle -= CLOCK_HZ
            updates += 1
            reg_c |= 0x10  # alarm (0,0,0) never equals 00:00:0s for s >= 1
        rtc_periodic += n * RTC_HZ
        if rtc_periodic >= CLOCK_HZ:
            rtc_periodic %= CLOCK_HZ
            reg_c |= 0x40
        applied += n
        if kb_scheduled:
            kb_remaining = max(0, kb_remaining - min(n, kb_remaining))
            if kb_remaining <= 0:
                kb_queue.append({'value': 0xAA, 'keyboard': True})
                kb_scheduled = False

    def horizon():
        h = max(1, CLOCK_HZ - rtc_cycle)
        pos = applied % FRAME
        h = min(h, ACTIVE - pos if pos < ACTIVE else FRAME - pos)
        if kb_scheduled:
            h = min(h, kb_remaining)
        return max(1, min(math.floor(h), CAP))

    while done < steps:
        if debt >= deadline:
            flush(debt)
            debt = 0
            deadline = horizon()
        k = min(-(-(deadline - debt) // CHARGE), steps - done)
        k = max(1, k)
        debt += CHARGE * k
        done += k
    if updates >= 86_399:
        raise ValueError('outside derived RTC alarm domain')
    return {
        'machineCycles': CHARGE * steps, 'debt': debt, 'deadline': deadline,
        'appliedClocks': applied, 'pitFraction': frac,
        'rtc': {'cyclePhase': rtc_cycle, 'periodicPhase': rtc_periodic, 'registerB': 2, 'registerC': reg_c},
        'cga': {'cycles': applied, 'frameCount': 0 if applied < ACTIVE else (applied - ACTIVE) // FRAME + 1,
                'lastVretrace': 1 if applied % FRAME >= ACTIVE else 0},
        'keyboard': {'commandByte': 0, 'queue': kb_queue, 'scheduled': 1 if kb_scheduled else 0},
    }


if __name__ == '__main__':
    import json, sys
    print(json.dumps(derive(int(sys.argv[1]) if len(sys.argv) > 1 else 10_000_000)))
