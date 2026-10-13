'Byte-only canonical STORED framing; emits no validation or authority verdict.'

import struct, zlib

CAPS = {'envelope.json': 131072,
 'stdout.prefix': 65536,
 'stderr.prefix': 65536,
 'status.txt': 1024,
 'source-before.json': 65536,
 'source-after.json': 65536,
 'descriptor.json': 8192,
 'role-table.json': 65536,
 'resources.json': 8192}

class Refusal(ValueError):
    pass

def assemble(members):
    if type(members) is not dict or len(members) > 9 or (not all((type(k) is str and len(k) <= 32 for k in members))):
        raise Refusal('member-shape')
    if not {'envelope.json', 'stdout.prefix', 'stderr.prefix', 'status.txt'} <= set(members) or not set(members) <= set(CAPS):
        raise Refusal('member-roles')
    if not all((type(v) is bytes and len(v) <= CAPS[k] for k, v in members.items())):
        raise Refusal('member-cap')
    snapshot = tuple(((name, members[name]) for name in CAPS if name in members))
    if sum((len(body) for _, body in snapshot)) > 524288:
        raise Refusal('decoded-cap')
    local = []
    central = []
    offset = 0
    for name, body in snapshot:
        encoded = name.encode('ascii')
        crc = zlib.crc32(body) & 4294967295
        extent = len(body)
        header = struct.pack('<I5H3I2H', 67324752, 20, 0, 0, 0, 33, crc, extent, extent, len(encoded), 0)
        local.extend((header, encoded, body))
        central.extend((struct.pack('<I6H3I5H2I', 33639248, 788, 20, 0, 0, 0, 33, crc, extent, extent, len(encoded), 0, 0, 0, 0, 33188 << 16, offset), encoded))
        offset += len(header) + len(encoded) + extent
    cd = b''.join(central)
    result = b''.join(local) + cd + struct.pack('<I4H2IH', 101010256, 0, 0, len(snapshot), len(snapshot), len(cd), offset, 0)
    if len(result) > 524288:
        raise Refusal('zip-cap')
    return result
