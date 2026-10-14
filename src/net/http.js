/**
 * A small HTTP/1.x server for the host-side node: enough for a simulated
 * machine's browser or client to fetch something from "the network".
 *
 * One request per connection; the reply always says `Connection: close` and
 * the connection is then closed. A request body needs a Content-Length;
 * chunked request bodies are refused (411). Headers are capped at 8 KB and a
 * body at 1 MB, each refused with its own status rather than read forever.
 *
 * @module
 */

const MAX_HEAD = 8192;
const MAX_BODY = 1 << 20;
const REASONS = {200: 'OK', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 411: 'Length Required', 413: 'Content Too Large',
    431: 'Request Header Fields Too Large', 500: 'Internal Server Error', 502: 'Bad Gateway', 504: 'Gateway Timeout'};

const latin1 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return s; };
const bytesOf = text => Array.from(text, ch => ch.charCodeAt(0) & 0xff);

/**
 * Try to read one request from the bytes received so far.
 * @returns {null | {error: number} | {method, path, version, headers, body: Uint8Array}} null: not complete yet
 */
export function parseRequest (bytes) {
    let end = -1;
    for (let i = 3; i < bytes.length && i < MAX_HEAD + 4; i++) {
        if (bytes[i] === 10 && bytes[i - 1] === 13 && bytes[i - 2] === 10 && bytes[i - 3] === 13) { end = i + 1; break; }
    }
    if (end < 0) return bytes.length > MAX_HEAD ? {error: 431} : null;
    const lines = latin1(bytes.slice(0, end - 4)).split('\r\n');
    const first = /^([A-Z]+) (\S+) HTTP\/(1\.[01])$/.exec(lines[0]);
    if (!first) return {error: 400};
    const headers = {};
    for (const line of lines.slice(1)) {
        const at = line.indexOf(':');
        if (at <= 0) return {error: 400};
        headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
    }
    if (/chunked/i.test(headers['transfer-encoding'] || '')) return {error: 411};
    let length = 0;
    if (headers['content-length'] !== undefined) {
        if (!/^\d+$/.test(headers['content-length'])) return {error: 400};
        length = Number(headers['content-length']);
        if (length > MAX_BODY) return {error: 413};
    }
    if (bytes.length < end + length) return null;
    return {method: first[1], path: first[2], version: first[3], headers, body: Uint8Array.from(bytes.slice(end, end + length))};
}

/** The bytes of a response. `body` is a string (sent as Latin-1) or bytes. */
export function formatResponse ({status = 200, headers = {}, body = ''} = {}) {
    const payload = typeof body === 'string' ? bytesOf(body) : Array.from(body);
    const out = {'content-length': String(payload.length), connection: 'close'};
    for (const [k, v] of Object.entries(headers)) {
        const key = k.toLowerCase();
        // These two are this server's to state; a handler cannot contradict the bytes actually sent.
        if (key !== 'content-length' && key !== 'connection' && key !== 'transfer-encoding') out[key] = String(v);
    }
    const head = `HTTP/1.1 ${status} ${REASONS[status] || 'Status'}\r\n` +
        Object.entries(out).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n';
    return [...bytesOf(head), ...payload];
}

/**
 * Answer one HTTP request on an established TCP connection.
 * `handler(request, respond)` returns a response object, or calls
 * `respond(response)` later and returns nothing.
 */
export function answerHttp (connection, handler) {
    const buffer = [];
    let done = false;
    const respond = response => {
        if (done || connection.state === 'CLOSED') return;
        done = true;
        connection.write(formatResponse(response));
        connection.end();
    };
    connection.on('data', data => {
        if (done) return;
        for (const b of data) buffer.push(b);
        const request = parseRequest(buffer);
        if (!request) return;
        if (request.error) return respond({status: request.error, body: `${request.error} ${REASONS[request.error]}\n`});
        let result;
        try {
            result = handler({...request, remote: connection.remote}, respond);
        } catch (e) {
            return respond({status: 500, body: '500 Internal Server Error\n'});
        }
        if (result) respond(result);
    });
}

/** Serve HTTP on `port` of a node. */
export function serveHttp (node, port, handler) {
    node.tcp.listen(port, connection => answerHttp(connection, handler));
}
