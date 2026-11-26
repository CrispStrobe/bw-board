// SPDX-License-Identifier: MIT
// Parallel sector subset of Bob Applegate's Remote Disk Protocol v1.1.
const geometry = [0, 128, 256, 512, 1024];
const sectorRead = new Set([0x18, 0x1f]);
const sectorWrite = new Set([0x19, 0x20]);

export class Kim1CorshamDisk {
  constructor(image) {
    this.image = image.slice();
    this.reset();
  }

  reset() {
    this.frame = [];
    this.response = [];
    this.index = 0;
    this.hostWrites = false;
    this.strobe = false;
    this.ack = false;
  }

  update(pins, directions, data) {
    const hostWrites = !!(pins & directions & 1);
    const strobe = !!(pins & directions & 2);
    if (hostWrites !== this.hostWrites) {
      if (hostWrites) {
        this.frame = [];
        this.response = [];
        this.index = 0;
      }
      this.ack = !hostWrites && !strobe && this.response.length > 0;
    } else if (strobe !== this.strobe) {
      if (hostWrites) {
        if (strobe) this.receive(data);
        this.ack = strobe;
      } else {
        if (strobe && this.ack) this.index++;
        this.ack = !strobe && this.index < this.response.length;
      }
    }
    this.hostWrites = hostWrites;
    this.strobe = strobe;
  }

  get data() { return this.response[this.index] ?? 0xff; }

  receive(byte) {
    if (this.response.length) return;
    const frame = this.frame;
    frame.push(byte);
    const [command, drive, sizeCode] = frame;
    if (command === 0x01) {
      this.response = [0x81, ...Array.from('Brickwright\r\n1.1', char => char.charCodeAt(0)), 0];
      return;
    }
    if (command === 0x05) { this.response = [0x85]; return; }
    if (command === 0x14) {
      if (frame.length === 2) this.response = [0x93, drive === 0 ? 1 : 0];
      return;
    }
    const reading = sectorRead.has(command);
    if (!reading && !sectorWrite.has(command)) { this.response = [0x83, 20]; return; }
    const long = command >= 0x1f;
    const header = long ? 7 : 6;
    if (frame.length < header) return;
    const size = geometry[sizeCode];
    if (!size) { this.response = [0x83, 16]; return; }
    if (!reading && frame.length < header + size) return;
    const sector = long ? frame.slice(3, 7).reduce((value, next) => value * 256 + next, 0) :
      frame[3] * (frame[5] || 256) + frame[4];
    const offset = sector * size;
    if (drive !== 0) this.response = [0x83, 10];
    else if (offset + size > this.image.length) this.response = [0x83, 16];
    else if (reading) this.response = [0x94, ...this.image.subarray(offset, offset + size)];
    else {
      this.image.set(frame.slice(header), offset);
      this.response = [0x82];
    }
  }
}
