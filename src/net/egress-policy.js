/**
 * The real-network bridge as a user setting: what a simulated machine may
 * reach outside the simulation, and why not.
 *
 * WHY THIS IS A SETTING AND NOT A FEATURE THAT IS JUST ON. A program running
 * in an emulated machine is a program: one opened from a gallery or sent by
 * someone else is a stranger's. Connected to the real network it acts from
 * the user's own computer and address. `SAFETY_NOTES` says what that means in
 * plain words; an application shows them before the setting can be switched
 * on.
 *
 * WHAT THIS MODULE IS. Pure decisions, no I/O: it never opens a connection.
 * A gateway asks `decide()` for every destination and gets an answer and a
 * sentence. The same sentence is what the user sees when something is
 * refused.
 *
 * THE DEFAULTS ARE THE SAFE ONES.
 *   - mode 'off': nothing leaves the simulation.
 *   - this computer itself, multicast and broadcast: never reachable, in any mode.
 *   - the user's own network (private, link-local and carrier-NAT ranges):
 *     refused unless `allowLocalNetwork` is set as well.
 *   - port 25 (mail relay): refused in every mode.
 *   - mode 'web': TCP to ports 80 and 443 only. Mode 'all': any TCP or UDP port.
 * Connections are only ever made outwards; nothing here accepts one.
 *
 * @module
 */

export const EGRESS_MODES = Object.freeze(['off', 'web', 'all']);

/** The setting as an application stores it. */
export const DEFAULT_EGRESS = Object.freeze({mode: 'off', allowLocalNetwork: false});

/**
 * What switching the bridge on means. Shown to the user, in this order,
 * before the setting can be changed; an application may translate them but
 * not drop one.
 */
export const SAFETY_NOTES = Object.freeze([
    'Programs in the simulated machines can then send and receive data over your real internet connection.',
    'That traffic comes from your computer and your network address, exactly as if you had sent it yourself.',
    'A project made by someone else can contain a program that uses this without telling you. Only switch it on for projects you trust.',
    'Old operating systems and small boards usually cannot encrypt. What they send can be read on the way.',
    'Devices on your own network (router, printer, other computers) stay unreachable unless you allow them separately. Allowing them lets a simulated program talk to them.',
    'Your own computer is never reachable from a simulated machine, and nothing outside can open a connection into the simulation.',
    'Every connection is listed while it is open, and switching the setting off closes them all.',
]);

const parse = text => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(text));
    if (!m || m.slice(1).some(p => Number(p) > 255)) return null;
    return m.slice(1).map(Number);
};

/**
 * What kind of place an IPv4 address is.
 * @returns {'public'|'this-computer'|'local-network'|'multicast'|'broadcast'|'unspecified'|'reserved'|'not-an-address'}
 */
export function classify (address) {
    const p = parse(address);
    if (!p) return 'not-an-address';
    const [a, b, c, d] = p;
    if (a === 0) return 'unspecified';                                  // 0.0.0.0/8
    if (a === 127) return 'this-computer';                              // loopback
    if (a === 10) return 'local-network';                               // RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return 'local-network';        // RFC 1918
    if (a === 192 && b === 168) return 'local-network';                 // RFC 1918
    if (a === 169 && b === 254) return 'local-network';                 // link-local, RFC 3927
    if (a === 100 && b >= 64 && b <= 127) return 'local-network';       // carrier-grade NAT, RFC 6598
    if (a === 255 && b === 255 && c === 255 && d === 255) return 'broadcast';
    if (a >= 224 && a <= 239) return 'multicast';
    if (a >= 240) return 'reserved';                                    // 240.0.0.0/4
    if (a === 192 && b === 0 && c === 0) return 'reserved';             // protocol assignments
    if ((a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113)) return 'reserved';         // documentation ranges
    if (a === 198 && (b === 18 || b === 19)) return 'reserved';         // benchmarking
    return 'public';
}

/** A setting object with nothing missing and nothing unknown; throws on a mode that does not exist. */
export function normalize (settings) {
    const s = {...DEFAULT_EGRESS, ...(settings || {})};
    if (!EGRESS_MODES.includes(s.mode)) throw new Error(`egress: unknown mode "${s.mode}" (${EGRESS_MODES.join(', ')})`);
    return {mode: s.mode, allowLocalNetwork: s.allowLocalNetwork === true};
}

/**
 * May a simulated machine open this connection?
 *
 * The address must be the one that will actually be connected to: a caller
 * that resolves a name decides on the RESULT, or a name pointing at the
 * user's router would walk past the local-network rule.
 *
 * @param {{mode?: string, allowLocalNetwork?: boolean}} settings
 * @param {{address: string, port: number, protocol: 'tcp'|'udp'}} destination
 * @returns {{allow: boolean, reason: string}} `reason` is a sentence for the user
 */
export function decide (settings, destination) {
    const s = normalize(settings);
    const {address, port, protocol} = destination || {};
    const no = reason => ({allow: false, reason});
    if (s.mode === 'off') return no('The real-network bridge is switched off.');
    if (protocol !== 'tcp' && protocol !== 'udp') return no(`Only TCP and UDP can cross the bridge, not ${protocol}.`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return no(`${port} is not a port.`);
    const kind = classify(address);
    if (kind === 'not-an-address') return no(`${address} is not an IPv4 address.`);
    if (kind === 'this-computer') return no(`${address} is this computer itself, which a simulated machine may never reach.`);
    if (kind === 'unspecified' || kind === 'reserved') return no(`${address} is not an address a connection can be made to.`);
    if (kind === 'multicast' || kind === 'broadcast') return no(`${address} addresses many machines at once, which does not cross the bridge.`);
    if (kind === 'local-network' && !s.allowLocalNetwork) {
        return no(`${address} is on your own network. Reaching it is switched off.`);
    }
    if (port === 25) return no('Port 25 (sending mail directly) is never opened.');
    if (s.mode === 'web') {
        if (protocol !== 'tcp' || (port !== 80 && port !== 443)) {
            return no(`The bridge is set to web only: ${protocol.toUpperCase()} port ${port} is not port 80 or 443.`);
        }
    }
    return {allow: true, reason: kind === 'local-network' ?
        `${address} is on your own network, which you have allowed.` : `${address} is on the internet.`};
}
