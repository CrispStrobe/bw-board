// Guarded word access for a newly constructed machine. Byte APIs remain the
// fallback for observations, memory remapping, devices, video and boundaries.
export function installI8086RamWordAccess(machine) {
    const cpu = machine.cpu, memory = machine.mem;
    const read = cpu.read, write = cpu.write;
    const machineRead = machine._read, machineWrite = machine._write;
    const rd16 = cpu._rd16, wr16 = cpu._wr16;
    cpu._rd16 = function(seg, off) {
        const offset = off & 65535, address = ((seg << 4) + offset) & 0xfffff;
        if (this.busTrace === null && this.read === read && machine._read === machineRead &&
            machine.mem === memory && offset !== 65535 && (address & 4095) !== 4095) {
            const kind = machine._page[address >>> 12];
            if (kind === 1 || kind === 2) return memory[address] | memory[address + 1] << 8;
        }
        return rd16.call(this, seg, off);
    };
    cpu._wr16 = function(seg, off, value) {
        const offset = off & 65535, address = ((seg << 4) + offset) & 0xfffff;
        if (this.busTrace === null && this.write === write && machine._write === machineWrite &&
            machine.mem === memory && offset !== 65535 && (address & 4095) !== 4095 &&
            (address < 0xa0000 || address > 0xbffff) && machine._page[address >>> 12] === 1) {
            memory[address] = value & 255; memory[address + 1] = value >> 8 & 255;
            return;
        }
        wr16.call(this, seg, off, value);
    };
}
