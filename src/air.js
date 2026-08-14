/**
 * The air — a general shared-medium engine for everything that crosses
 * space instead of copper: Bluetooth SPP (hc05), 433/900 MHz OOK
 * (rf433), nRF24 packet pipes, LoRa, IR beams, FPV video — each a KIND
 * with its own payload semantics, all sharing one membership/delivery
 * core. A space is `${kind}:${band}` — the kind keeps mediums from
 * hearing each other (an HC-05 never receives 433 MHz frames), the band
 * is the tuning knob (air name, channel number, frequency, room).
 *
 * A member is { addr(), deliver(payload, fromAddr), state }: addr is a
 * FUNCTION so live renames/retunes are visible to inquirers; deliver
 * receives whatever the kind's devices define as payload (bytes for
 * serial bridges, level edges for OOK, packets for pipes); state is the
 * device's own state object for kinds that need deeper coupling (the
 * HC-05's symmetric link touches its peer's linked/STATE pin — that is
 * KIND semantics, deliberately built on top rather than baked in).
 *
 * Deliberately unmodeled at the core: range, loss, interference,
 * airtime. A kind that wants them adds them in ITS delivery layer —
 * LoRa airtime budgets and IR line-of-sight belong to their kinds, not
 * to the registry. Module-scoped: one process's boards share spaces, so
 * tests use fresh band names or resetAir (documented since the HC-05
 * air's contamination bite).
 *
 * @module
 */

const SPACES = new Map();

/** @param {string} space `${kind}:${band}` */
export function joinAir(space, member) {
    if (!SPACES.has(space)) SPACES.set(space, new Set());
    SPACES.get(space).add(member);
    member._space = space;
    return member;
}

export function leaveAir(member) {
    const set = SPACES.get(member._space);
    if (set) set.delete(member);
}

export function airOthers(member) {
    const set = SPACES.get(member._space);
    if (!set) return [];
    return [...set].filter((m) => m !== member);
}

export function airFind(member, addr) {
    return airOthers(member).find((m) => m.addr() === addr) || null;
}

/**
 * Deliver payload to the space: to one address, or broadcast to all
 * others when toAddr is null. Returns how many members received it.
 */
export function airSend(member, payload, toAddr = null) {
    let n = 0;
    for (const other of airOthers(member)) {
        if (toAddr !== null && other.addr() !== toAddr) continue;
        other.deliver(payload, member.addr());
        n++;
    }
    return n;
}

/** Test hygiene: drop a whole space. */
export function resetAir(space) { SPACES.delete(space); }
