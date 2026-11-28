// SPDX-License-Identifier: MIT
// Bob Applegate's Remote Disk Protocol v1.1, with mutually exclusive
// sector-image and session-local loose-file media.
const MAX_FILES = 64;
const MAX_FILE_BYTES = 65536;
const MAX_TOTAL_BYTES = 2097152;
const validName = name => typeof name === 'string' && /^[A-Z0-9_-]{1,8}(\.[A-Z0-9_-]{1,3})?$/i.test(name);
const geometry = [0, 128, 256, 512, 1024];
const sectorRead = new Set([0x18, 0x1f]);
const sectorWrite = new Set([0x19, 0x20]);

export class Kim1CorshamDisk {
  constructor(image, files = null) {
    this.image = image.slice();
    this.files = null;
    if (files !== null) {
      if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error('Choose up to 64 Corsham files.');
      this.files = new Map();
      let total = 0;
      for (const {name, bytes} of files) {
        const normalized = validName(name) ? name.toUpperCase() : null;
        if (!normalized || this.files.has(normalized) || !(bytes instanceof Uint8Array) ||
          bytes.length > MAX_FILE_BYTES || (total += bytes.length) > MAX_TOTAL_BYTES) {
          throw new Error('Corsham files need unique 8.3 names, at most 64 KiB each and 2 MiB in total.');
        }
        this.files.set(normalized, bytes.slice());
      }
      this.names = [...this.files.keys()].sort();
      this.fileBytes = total;
    }
    this.reset();
  }

  reset() {
    this.directoryIndex = null;
    this.openFile = null;
    this.pendingFile = null;
    this.offset = 0;
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
      } else if (this.directoryIndex !== null && !this.response.length) {
        const name = this.names[this.directoryIndex++];
        this.response = name === undefined ? [0x91] : [0x90, ...Array.from(name, char => char.charCodeAt(0)), 0];
        if (name === undefined) this.directoryIndex = null;
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
    if (frame.length === 1) this.directoryIndex = null;
    if (this.files && this.receiveFileCommand(command, byte)) return;
    if (command === 0x01) {
      this.response = [0x81, ...Array.from('Brickwright\r\n1.1', char => char.charCodeAt(0)), 0];
      return;
    }
    if (command === 0x05) { this.response = [0x85]; return; }
    if (command === 0x14) {
      if (frame.length === 2) this.response = [0x93, drive === 0 && this.image.length ? 1 : 0];
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

  receiveFileCommand(command, byte) {
    const frame = this.frame;
    switch (command) {
    case 0x10: // Directory entries are resumed at each read-direction transition.
      this.directoryIndex = 0;
      return true;
    case 0x15:
      this.openFile = null;
      this.commitPendingFile();
      this.frame = []; // DONE has no reply. The next command may arrive while the host still drives the bus.
      return true;
    case 0x16:
    case 0x1b:
      if (frame.length === 1) {
        this.openFile = null;
        this.pendingFile = null;
      } else if (frame.length > 14) {
        this.response = [0x83, 12];
      } else if (byte === 0) {
        const requested = String.fromCharCode(...frame.slice(1, -1));
        const name = requested.toUpperCase();
        if (!validName(requested)) {
          this.response = [0x83, 12];
        } else if (command === 0x16) {
          this.openFile = this.files.get(name) ?? null;
          this.offset = 0;
          this.response = this.openFile ? [0x82] : [0x83, 12];
        } else if (!this.files.has(name) && this.files.size === MAX_FILES) {
          this.response = [0x83, 18];
        } else {
          this.pendingFile = {name, chunks: [], length: 0, previousLength: this.files.get(name)?.length ?? 0};
          this.response = [0x82];
        }
      }
      return true;
    case 0x17:
      if (frame.length === 2) {
        const bytes = this.openFile?.subarray(this.offset, this.offset + byte) ?? [];
        this.offset += bytes.length;
        this.response = [0x92, bytes.length, ...bytes];
      }
      return true;
    case 0x1c:
      if (frame.length === 2 + frame[1]) this.appendFileChunk(frame.slice(2));
      return true;
    default:
      return false;
    }
  }

  appendFileChunk(bytes) {
    const file = this.pendingFile;
    if (!file || file.length + bytes.length > MAX_FILE_BYTES ||
      this.fileBytes - file.previousLength + file.length + bytes.length > MAX_TOTAL_BYTES) {
      this.pendingFile = null;
      this.response = [0x83, 18];
      return;
    }
    if (bytes.length) file.chunks.push(bytes);
    file.length += bytes.length;
    this.response = [0x82];
  }

  commitPendingFile() {
    const file = this.pendingFile;
    if (!file) return;
    const bytes = new Uint8Array(file.length);
    let offset = 0;
    for (const chunk of file.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    this.fileBytes += bytes.length - file.previousLength;
    this.files.set(file.name, bytes);
    this.names = [...this.files.keys()].sort();
    this.pendingFile = null;
  }

  exportFiles() {
    return (this.names ?? []).map(name => ({name, bytes: this.files.get(name).slice()}));
  }
}
