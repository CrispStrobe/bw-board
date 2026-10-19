/** Candidate type adaptation only; held budget/return guards remain unchanged. */
export {modes,nextBudget,validateReturn,noArtificialNativeDeadline} from './held-protocol.mjs';
import {compareReset as heldReset,compareFinalEvidence as heldFinal} from './held-protocol.mjs';
import {plainSnapshot} from './snapshot.mjs';
export function compareReset(native,board,capture){return heldReset(plainSnapshot(native),board,capture);}
export function compareFinalEvidence(native,settled,ports,capture,last){return heldFinal(plainSnapshot(native),settled,ports,capture,plainSnapshot(last));}
