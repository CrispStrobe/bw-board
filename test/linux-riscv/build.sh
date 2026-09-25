#!/usr/bin/env bash
# Fetch the RV32 Linux kernel and cut the busybox initramfs for boot.mjs.
#
#   bash test/linux-riscv/build.sh OUTDIR
#
# Kernel and userland are rv32emu's prebuilt Linux image (sysprog21/
# rv32emu-prebuilt release 2026.09.23-19f5a79-Linux-Image: Linux 6.1.188 and a
# Buildroot 2025.11 glibc/busybox rootfs, built by rv32emu's CI from the
# configs in sysprog21/rv32emu@19f5a7984e54292df025d747f87a7728e7cfb3eb,
# assets/system/configs). It is fetched, never committed (GPL/LGPL), and
# checked by SHA-256. From its rootfs.cpio this keeps only busybox and the
# three libraries it loads, adds an /init that mounts proc/sys/devtmpfs,
# prints BWB-LINUX-USERSPACE-UP and starts a login shell on ttyS0 (or, for
# initramfs-poweroff.cpio, powers off at once), and writes a reproducible newc
# archive (mkcpio.py: owners 0, mtimes 0, /dev/console added without root).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mkdir -p "$1" && cd "$1" && pwd)"
URL=https://github.com/sysprog21/rv32emu-prebuilt/releases/download/2026.09.23-19f5a79-Linux-Image/rv32emu-linux-image-prebuilt.tar.gz
SHA256=0352bbd2dc8d35703516f7e4db86c27fbabb39818c7034a74dff948913e462fd
IMAGE_SHA1=de75054185afefe92baf8b20bbbd03fe4d1d4715
work="$(mktemp -d)"
curl -sSfL -o "$work/img.tgz" "$URL"
echo "$SHA256  $work/img.tgz" | sha256sum -c -
tar --strip-components=1 -zxf "$work/img.tgz" -C "$work"
echo "$IMAGE_SHA1  $work/linux-image/Image" | sha1sum -c -
cp "$work/linux-image/Image" "$out/Image"

mkdir -p "$work/full" && (cd "$work/full" && cpio -idm --quiet < "$work/linux-image/rootfs.cpio" 2>/dev/null || true)
make_root() {        # dir init-script
    local r="$1"
    mkdir -p "$r"/{bin,sbin,lib,proc,sys,dev,tmp,etc,root,usr/bin,usr/sbin}
    cp "$work/full/bin/busybox" "$r/bin/"
    for l in ld-linux-riscv32-ilp32.so.1 libc.so.6 libresolv.so.2; do cp -L "$work/full/lib/$l" "$r/lib/"; done
    ln -sfn lib "$r/lib32"                                   # the loader searches /lib32
    printf '%s\n' "$2" > "$r/init"; chmod 755 "$r/init"
    echo 'export PS1="bwb# "' > "$r/etc/profile"
}
make_root "$work/shell" '#!/bin/busybox sh
/bin/busybox --install -s
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t sysfs sysfs /sys
/bin/busybox mount -t devtmpfs devtmpfs /dev 2>/dev/null
echo "BWB-LINUX-USERSPACE-UP"
exec /bin/busybox setsid /bin/busybox sh -c "exec /bin/busybox sh -l </dev/ttyS0 >/dev/ttyS0 2>&1"'
make_root "$work/off" '#!/bin/busybox sh
/bin/busybox echo BWB-LINUX-USERSPACE-UP
/bin/busybox poweroff -f'
python3 "$here/mkcpio.py" "$work/shell" "$out/initramfs.cpio"
python3 "$here/mkcpio.py" "$work/off" "$out/initramfs-poweroff.cpio"
rm -rf "$work"
sha256sum "$out"/*
