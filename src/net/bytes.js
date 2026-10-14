/**
 * Byte helpers the network code shares: big-endian fields and the Internet checksum.
 * @module
 */

/** The Internet checksum (RFC 1071) of `bytes`, optionally continuing from `sum`. */
export function checksum (bytes, sum = 0) {
    for (let i = 0; i + 1 < bytes.length; i += 2) sum += (bytes[i] << 8) | bytes[i + 1];
    if (bytes.length & 1) sum += bytes[bytes.length - 1] << 8;
    while (sum >>> 16) sum = (sum & 0xffff) + (sum >>> 16);
    return (~sum) & 0xffff;
}

export const be16 = (b, at) => (b[at] << 8) | b[at + 1];
export const be32 = (b, at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
export const put16 = v => [(v >>> 8) & 0xff, v & 0xff];
export const put32 = v => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
