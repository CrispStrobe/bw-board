/** Device-gate attribution, layered over the immutable memory-map transform. */
import {patchPinnedSource as patchMemoryMap,revision,sha256,upstreamHashes}
  from '../bochs-cpu3-native-memory-map/patch.mjs';
export {revision,sha256,upstreamHashes};

export function patchPinnedSource(path,bytes) {
  const source=patchMemoryMap(path,bytes).toString('utf8');
  return Buffer.from(source);
}
