#!/usr/bin/env python3
"""Write a newc initramfs from a directory, adding /dev/console (char 5,1) —
no root needed, all owners 0, all mtimes 0, sorted: reproducible bytes."""
import os, stat, sys
src, out = sys.argv[1], sys.argv[2]
entries = []
for dp, dns, fns in os.walk(src):
    dns.sort()
    for n in sorted(dns + fns):
        p = os.path.join(dp, n)
        entries.append(os.path.relpath(p, src))
entries.sort()
def hdr(name, mode, size, ino, rdevmaj=0, rdevmin=0, nlink=1):
    f = ['070701', ino, mode, 0, 0, nlink, 0, size, 0, 0, rdevmaj, rdevmin, len(name) + 1, 0]
    return (f[0] + ''.join('%08x' % v for v in f[1:])).encode()
buf = bytearray()
def pad(): 
    while len(buf) % 4: buf.append(0)
def add(name, mode, data=b'', rdev=(0, 0)):
    buf.extend(hdr(name, mode, len(data), len(buf) // 4 % 0xffffff + 1, *rdev)); buf.extend(name.encode() + b'\0'); pad()
    buf.extend(data); pad()
names = set(entries)
for e in entries:
    p = os.path.join(src, e); st = os.lstat(p)
    if stat.S_ISLNK(st.st_mode): add(e, 0o120777, os.readlink(p).encode())
    elif stat.S_ISDIR(st.st_mode): add(e, 0o040755)
    else: add(e, 0o100755 if st.st_mode & 0o111 else 0o100644, open(p, 'rb').read())
if 'dev' not in names: add('dev', 0o040755)
add('dev/console', 0o020600, rdev=(5, 1))
add('TRAILER!!!', 0)
while len(buf) % 512: buf.append(0)
open(out, 'wb').write(buf)
print(out, len(buf))
