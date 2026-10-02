import test from 'node:test';
test('fixed source-only 8042 owner/device controls and tiny JavaScript ROM probe',async()=>{
 await import('../scripts/bochs-cpu3-native-owned-8042/controls.mjs');
});
