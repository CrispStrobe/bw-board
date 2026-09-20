export function gradeI80386VgaBiosEvidence(evidence) {
  const predicates = {
    completed: evidence.outcome === 'int10-vram-roundtrip',
    optionPost: !!evidence.optionEntry && !!evidence.firmwareReturn &&
      evidence.optionPostInstructions > 0 && evidence.optionVgaPorts.length > 0,
    installedService: evidence.int10Vector?.cs === 0xc000 &&
      evidence.int10ServiceEntry?.cs === evidence.int10Vector.cs &&
      evidence.int10ServiceEntry?.eip === evidence.int10Vector.ip &&
      evidence.int10ServiceInstructions > 0,
    mode13: evidence.guestVgaPorts.length > 0 && evidence.bdaVideoMode === 0x13 &&
      (evidence.videoState.seq[4] & 0x08) !== 0,
    readbackMarker: evidence.guestMarker?.cs === 0 && evidence.guestMarker?.eip === 0x526 &&
      evidence.guestMarker?.value === 0xa5,
  };
  return {accepted: Object.values(predicates).every(Boolean), predicates};
}
