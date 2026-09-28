import fs from 'node:fs';

/** Mirror guest COM1 bytes to an exclusive private file when requested. */
export function createXv6SerialTee(filePath) {
  if (!filePath) return null;
  const fd = fs.openSync(filePath, 'wx', 0o600);
  const byte = Buffer.allocUnsafe(1);
  return {
    writeByte(value) {
      byte[0] = value & 0xff;
      fs.writeSync(fd, byte);
    },
    close() { fs.closeSync(fd); },
  };
}
