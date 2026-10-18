import {bindAtMainCut,consumeVerifiedTextMismatch} from '../i80386-cwsdpmi-at-loaded-actual/cut.mjs';

// A separate, narrower source profile. It never changes the strict whole-text
// result and never accepts a caller-supplied error, RAM copy, or role receipt.
const requiredRoles=Object.freeze(['allocateLdt','allocateMemory','freeLdt',
  'freeMemory','main','setBase','setLimit','simulateInt']);
const active=new WeakMap();

function exactOwnedRoles(diagnostic) {
  if(diagnostic?.schema!=='bw.cwsdpmi-owned.loaded-text-mismatch.v1' ||
      !Number.isSafeInteger(diagnostic.changedBytes) || diagnostic.changedBytes<1 ||
      diagnostic.expectedSha256===diagnostic.observedSha256 ||
      !diagnostic.roles ||
      Object.keys(diagnostic.roles).sort().join()!==requiredRoles.join())
    return false;
  return requiredRoles.every(name=>{
    const role=diagnostic.roles[name];
    return role?.equal===true && role.expectedSha256===role.observedSha256 &&
      /^[0-9a-f]{64}$/.test(role.expectedSha256) &&
      Number.isSafeInteger(role.address) && Number.isSafeInteger(role.bytes) &&
      role.bytes>0 && typeof role.member==='string';
  });
}

export function bindOwnedCodeAtMain(machine,layout) {
  if(!machine || typeof machine!=='object')throw new Error('owned-code machine');
  const state=active.get(machine)??{busy:false,failed:false,completed:false};
  active.set(machine,state);
  if(state.busy||state.failed||state.completed){
    state.failed=true;throw new Error('reentered/failed owned-code cut');
  }
  state.busy=true;
  try {
    let strict=null,strictError=null;
    try {strict=bindAtMainCut(machine,layout);}
    catch(error){strictError=error;}
    if(strictError===null){
      if(state.failed)throw new Error('failed owned-code cut');
      if(!strict?.binding || strict.before===undefined || strict.after===undefined)
        throw new Error('strict cut result shape');
      state.completed=true;
      return Object.freeze({schema:'bw.cwsdpmi-owned.code-at-entry.v1',
        strictWholeText:'PASS',ownedCodeAtEntry:'PASS',
        binding:strict.binding,textMismatch:null,
        before:Object.freeze({...strict.before}),
        after:Object.freeze({...strict.after})});
    }
    // The consume accessor is keyed by the *exact* Error that the frozen cut
    // threw after its private comparison. Structural Error fields have no
    // authority, and this does not invoke a second guest RAM read or cut.
    const verified=consumeVerifiedTextMismatch(machine,layout,strictError);
    if(state.failed)throw new Error('failed owned-code cut');
    if(!exactOwnedRoles(verified.diagnostic))
      throw new Error('owned main/wrapper bytes differ at strict mismatch');
    state.completed=true;
    return Object.freeze({schema:'bw.cwsdpmi-owned.code-at-entry.v1',
      strictWholeText:'FAIL',ownedCodeAtEntry:'PASS',
      strictFailure:`loaded text differs at byte ${verified.diagnostic.firstOffset}`,
      binding:null,textMismatch:verified.diagnostic,
      before:verified.before,after:verified.after});
  } catch(error){state.failed=true;throw error;}
  finally {state.busy=false;}
}
