/**
 * A LAN that emulated machines and host-side nodes share.
 *
 * It is the wire, nothing more: every member hears every frame except its
 * own, exactly as `HubLink` in ne2000.js does, and for the same reason: the
 * address filter belongs to the device, and a learner should be able to see
 * that. An NE2000 attaches here unchanged (`attach(card)` sets `card.link`,
 * the card calls `link.send(frame, card)` and is given frames through
 * `card.deliver(frame)`).
 *
 * What this adds to the hub: members that are not cards. A host-side node
 * (ipv4-node.js) is how a test or an application is "the network" a guest
 * talks to, and a tap sees every frame, which is what a packet trace is.
 *
 * SIMULATED PEERS ONLY. Nothing here reaches a real network. There is no
 * loss, delay, collision or bandwidth: a frame sent is delivered, at once and
 * in order, before `send` returns.
 *
 * @module
 */

/** Ethernet II without the frame check sequence: 14 header bytes up to 1500 of payload. */
export const MIN_FRAME = 14;
export const MAX_FRAME = 1514;

export class Lan {
    /** @param {{name?: string}} [opts] */
    constructor (opts = {}) {
        this.name = opts.name || 'lan';
        /** @type {Array<{deliver: (frame: Uint8Array) => void, link?: object}>} */
        this.members = [];
        this.taps = [];
        /** Frames accepted, deliveries made, frames refused for their length. */
        this.counters = {sent: 0, delivered: 0, refused: 0};
    }

    /** Put a card or node on the wire. Returns it, as HubLink.attach does. */
    attach (member) {
        if (!member || typeof member.deliver !== 'function') {
            throw new Error('lan: a member needs deliver(frame)');
        }
        if (!this.members.includes(member)) this.members.push(member);
        member.link = this;
        return member;
    }

    detach (member) {
        const at = this.members.indexOf(member);
        if (at >= 0) this.members.splice(at, 1);
        if (member && member.link === this) member.link = null;
    }

    /** See every frame put on the wire: `fn(frame, from)`. Returns a function that removes the tap. */
    tap (fn) {
        this.taps.push(fn);
        return () => { this.taps = this.taps.filter(t => t !== fn); };
    }

    /**
     * A member transmits. Every other member is given its own copy. A frame
     * shorter than an Ethernet header or longer than the maximum is refused
     * and counted: a device that sends one has a bug worth seeing.
     */
    send (frame, from) {
        if (!frame || frame.length < MIN_FRAME || frame.length > MAX_FRAME) {
            this.counters.refused++;
            return;
        }
        this.counters.sent++;
        const bytes = Uint8Array.from(frame);
        for (const tap of this.taps) tap(bytes, from);
        // A member may attach or detach while handling a frame; deliver to the set as it was.
        for (const member of this.members.slice()) {
            if (member === from) continue;
            member.deliver(Uint8Array.from(bytes));
            this.counters.delivered++;
        }
    }
}

export default Lan;
