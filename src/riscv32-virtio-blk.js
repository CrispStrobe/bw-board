/**
 * A legacy virtio-mmio (version 1) block device — the disk an OS kernel (xv6,
 * and Linux with a virtio-blk root) mounts its filesystem from. Registers sit at
 * `base` (0x10001000 for xv6); the driver programs one virtqueue via QUEUE_PFN
 * (the legacy single-page-frame layout) and kicks it with QUEUE_NOTIFY, at which
 * point this walks the available ring, services each block request against the
 * backing image, writes a status byte, posts to the used ring, and raises its
* PLIC line. Guest buffer addresses in the descriptors are physical (the kernel's
 * identity-mapped RAM), read/written through the CPU's physical accessors.
 *
 * @module
 */

// Legacy virtio-mmio register offsets.
const REG = {
    MAGIC: 0x000, VERSION: 0x004, DEVICE_ID: 0x008, VENDOR_ID: 0x00c,
    DEVICE_FEATURES: 0x010, DRIVER_FEATURES: 0x020, GUEST_PAGE_SIZE: 0x028,
    QUEUE_SEL: 0x030, QUEUE_NUM_MAX: 0x034, QUEUE_NUM: 0x038, QUEUE_ALIGN: 0x03c,
    QUEUE_PFN: 0x040, QUEUE_NOTIFY: 0x050, INTERRUPT_STATUS: 0x060,
    INTERRUPT_ACK: 0x064, STATUS: 0x070, CONFIG: 0x100
};
const SECTOR = 512;
const VRING_DESC_F_NEXT = 1, VRING_DESC_F_WRITE = 2;
const VIRTIO_BLK_T_OUT = 1;                 // write (0 = read)

/**
 * @param {import('./riscv32.js').RiscV32} cpu — for physical guest-memory access
 * @param {{base?: number, disk: Uint8Array, num?: number, setIrq?: (on:boolean)=>void}} opts
 */
export function createVirtioBlk(cpu, opts) {
    const base = opts.base ?? 0x10001000;
    const disk = opts.disk;
    const NUM = opts.num ?? 8;
    const setIrq = opts.setIrq || (() => {});
    let pfn = 0, queueNum = NUM, status = 0, intStatus = 0, pageSize = 4096;
    let lastAvail = 0;                        // last processed avail.idx

    const rd32 = a => cpu.ld32(a >>> 0) >>> 0;
    const rd16 = a => (cpu.ld8(a) | (cpu.ld8(a + 1) << 8)) & 0xffff;

    function process() {
        if (!pfn) return;
        const q = pfn * pageSize;             // queue base (physical)
        const descBase = q;
        const availBase = q + NUM * 16;       // avail = desc + NUM*sizeof(VRingDesc)
        const usedBase = q + pageSize;        // used = second page
        const availIdx = rd16(availBase + 2); // avail.idx
        while (lastAvail !== availIdx) {
            const head = rd16(availBase + 4 + (lastAvail % NUM) * 2);   // avail.ring[i]
            // Walk the descriptor chain: header, data(s), status.
            let d = head, header = -1, dataAddr = 0, dataLen = 0, statusAddr = 0;
            for (;;) {
                const da = descBase + d * 16;
                const addr = rd32(da);                 // addr (low 32 of the 64-bit field)
                const len = rd32(da + 8);
                const flags = rd16(da + 12);
                const next = rd16(da + 14);
                if (header < 0) header = addr;          // first desc: the request header
                else if (len === 1) statusAddr = addr;  // the 1-byte status (device-writable)
                else { dataAddr = addr; dataLen = len; } // the data buffer
                void flags;
                if (!(flags & VRING_DESC_F_NEXT)) break;
                d = next;
            }
            // The request header: type (u32), reserved (u32), sector (u64 lo/hi).
            const type = rd32(header);
            const sector = rd32(header + 8);            // low 32 bits of the sector number
            const off = sector * SECTOR;
            if (type === VIRTIO_BLK_T_OUT) {            // write: guest → image
                for (let i = 0; i < dataLen; i++) disk[off + i] = cpu.ld8(dataAddr + i) & 0xff;
            } else {                                    // read: image → guest
                for (let i = 0; i < dataLen; i++) cpu.st8(dataAddr + i, disk[off + i] | 0);
            }
            if (statusAddr) cpu.st8(statusAddr, 0);     // VIRTIO_BLK_S_OK
            // Post to the used ring.
            const usedIdx = rd16(usedBase + 2);
            const elem = usedBase + 4 + (usedIdx % NUM) * 8;
            cpu.st32(elem, head >>> 0);                 // used.ring[i].id
            cpu.st32(elem + 4, dataLen >>> 0);          // used.ring[i].len
            cpu.st8(usedBase + 2, (usedIdx + 1) & 0xff);
            cpu.st8(usedBase + 3, ((usedIdx + 1) >> 8) & 0xff);
            lastAvail = (lastAvail + 1) & 0xffff;
        }
        intStatus |= 1;
        setIrq(true);
    }

    return {
        base, size: 0x1000,
        load32(off) {
            switch (off) {
                case REG.MAGIC: return 0x74726976;         // "virt"
                case REG.VERSION: return 1;                // legacy
                case REG.DEVICE_ID: return 2;              // block device
                case REG.VENDOR_ID: return 0x554d4551;     // "QEMU"
                case REG.DEVICE_FEATURES: return 0;
                case REG.QUEUE_NUM_MAX: return NUM;
                case REG.QUEUE_PFN: return pfn;
                case REG.INTERRUPT_STATUS: return intStatus;
                case REG.STATUS: return status;
                case REG.CONFIG: return (disk.length / SECTOR) >>> 0;   // capacity (sectors), low word
                case REG.CONFIG + 4: return 0;
                default: return 0;
            }
        },
        store32(off, v) {
            v >>>= 0;
            switch (off) {
                case REG.GUEST_PAGE_SIZE: pageSize = v || 4096; break;
                case REG.QUEUE_NUM: queueNum = v; break;
                case REG.QUEUE_PFN: pfn = v; lastAvail = 0; break;
                case REG.QUEUE_NOTIFY: process(); break;
                case REG.INTERRUPT_ACK: intStatus &= ~v; if (intStatus === 0) setIrq(false); break;
                case REG.STATUS: status = v; break;
                default: break;
            }
        }
    };
}
