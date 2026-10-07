import test from 'node:test';
import assert from 'node:assert/strict';
import {createDebugTarget} from '../src/debug-target-factory.js';

test('386 debug memory reads see VGA text and high physical RAM without changing VGA latches',async()=>{
 const {adapter,target}=await createDebugTarget('i80386',{profile:'freedos-vga'});
 const m=adapter.machine,card=m.chips.vga1;
 // Text aperture with odd/even planes, as reached through the real 386 bus.
 card.misc=0x67;card.seq[2]=3;card.seq[4]=2;card.gc[5]=0x10;card.gc[6]=0x0e;card.gc[8]=0xff;
 m.cpu.write(0xb8000,0x47);m.cpu.write(0xb8001,0x1f);
 assert.deepEqual([m.cpu.read(0xb8000),m.cpu.read(0xb8001)],[0x47,0x1f]);
 assert.deepEqual([...m.vgaMemory.planes[0].subarray(0,1),...m.vgaMemory.planes[1].subarray(0,1)],[0x47,0x1f]);
 m.vgaMemory.latches.set([0x5a,0xa5,0x36,0xc9]);
 const before=[...m.vgaMemory.latches],text=target.readMem('mem',0xb8000,4000);
 assert(text instanceof Uint8Array);assert.equal(text.length,4000);
 assert.deepEqual([...text.subarray(0,2)],[0x47,0x1f]);
 assert.deepEqual([...m.vgaMemory.latches],before,'debug observation leaves the next guest write latches intact');
 card.gc[5]=0x11;m.cpu.write(0xb8002,0);assert.equal(m.vgaMemory.planes[0][2],0x5a,'guest write mode 1 still uses its prior latch');
 m._write386(0x200000,0x79);
 assert.equal(m._read386(0x200000),0x79);
 assert.deepEqual([...target.readMem('mem',0x200000,1)],[0x79],'386 debug address is not truncated to 20 bits');
 assert.match(target.readMem('io',0,1).unsupported,/destructive/);
});
