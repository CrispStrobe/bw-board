/**
 * A ready-made simulated network: one LAN, a router that hands out addresses
 * and resolves names, optional simulated hosts, and the real-network bridge
 * in whatever state the user's setting puts it (off, unless told otherwise).
 *
 * This is the assembly an application wants; the parts are lan.js,
 * ipv4-node.js, gateway.js and egress-policy.js, and each says what it does
 * not do. Emulated machines join with `world.lan.attach(card)`.
 *
 * @module
 */
import {Lan} from './lan.js';
import {Ipv4Node, ip, ipText} from './ipv4-node.js';
import {Gateway} from './gateway.js';
import {serveHttp} from './http.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.router='10.0.0.1'] the router's address; the subnet is its /24
 * @param {{first: string, last: string}} [opts.dhcp] the pool; default .100 to .199 of the subnet
 * @param {object} [opts.egress] the user's bridge setting; default off
 * @param {object} [opts.transport] how real connections are opened (gateway.js); default none
 * @param {(event: object) => void} [opts.onDecision]
 */
export function createLanWorld (opts = {}) {
    const routerIp = ip(opts.router || '10.0.0.1');
    const subnet = (routerIp & 0xffffff00) >>> 0;
    const at = host => ipText((subnet | host) >>> 0);
    const lan = new Lan({name: opts.name || 'lan'});
    const router = lan.attach(new Ipv4Node({mac: [0x02, 0x62, 0x77, 0x01, 0x00, 0x01], ip: ipText(routerIp), name: 'router'}));
    const gateway = new Gateway(router, {settings: opts.egress, transport: opts.transport, onDecision: opts.onDecision});
    router.serveDhcp(opts.dhcp || {first: at(100), last: at(199)});
    router.serveDns({'router.lan': ipText(routerIp)}, {resolve: gateway.resolver});
    const hosts = new Map();
    let nextHost = 2;

    return {
        lan, router, gateway, hosts,

        /**
         * Add a simulated host: a node on the LAN with a name guests can resolve.
         * `name` gets ".lan" unless it already has a dot. Returns the node; give
         * it services with `node.udpBind`, `node.tcp.listen` or `world.serveHttp`.
         */
        addHost (name, address) {
            const full = name.includes('.') ? name.toLowerCase() : `${name.toLowerCase()}.lan`;
            if (hosts.has(full)) throw new Error(`world: a host named ${full} already exists`);
            if (nextHost > 99) throw new Error('world: no host addresses left below the DHCP pool');
            const number = nextHost++;
            const hostIp = address || at(number);
            const node = lan.attach(new Ipv4Node({mac: [0x02, 0x62, 0x77, 0x01, 0x00, number], ip: hostIp,
                name: full, via: ipText(routerIp)}));
            router.dns.set(full, ip(hostIp));
            hosts.set(full, node);
            return node;
        },

        /** Serve HTTP from a host of this world, by name. */
        serveHttp (name, handler, port = 80) {
            const node = hosts.get(name.includes('.') ? name.toLowerCase() : `${name.toLowerCase()}.lan`);
            if (!node) throw new Error(`world: no host named ${name}`);
            serveHttp(node, port, handler);
        },

        /** The user changed the bridge setting. */
        setEgress (settings) { gateway.setSettings(settings); },

        /** What is on this network, for a status display. */
        describe () {
            return {
                router: ipText(routerIp),
                egress: {...gateway.settings},
                hosts: [...hosts].map(([name, node]) => ({name, address: ipText(node.ip)})),
                leases: [...router.dhcp.leases].map(([mac, address]) => ({mac, address: ipText(address)})),
                members: lan.members.length,
                connections: gateway.connections.map(c => ({...c})),
            };
        },
    };
}

export {Lan} from './lan.js';
export {Ipv4Node, ip, ipText, mac, macText} from './ipv4-node.js';
export {Gateway} from './gateway.js';
export {serveHttp, parseRequest, formatResponse} from './http.js';
export {decide, classify, normalize, DEFAULT_EGRESS, EGRESS_MODES, SAFETY_NOTES} from './egress-policy.js';
