// SPDX-License-Identifier: MIT
/** One execution owner: an attached Board device, or a standalone virtual clock. */
import {
  CARDIAC_MODEL, createCardiacMachine, controlCardiacMachine,
  stepCardiacMachine, snapshotCardiacMachine
} from './cardiac-machine.js';
import {cardiacInstructionPeriodNs} from './devices/cardiac.js';

export function createCardiacAdapter(options = {}) {
  const standalone = options.machine ?? (options.board ? null : createCardiacMachine(options.program));
  if (standalone && standalone.model !== CARDIAC_MODEL) throw new Error('A CARDIAC adapter requires a CARDIAC machine.');
  const period = cardiacInstructionPeriodNs({params: {instructionHz: options.instructionHz}});
  let board = null, partId = null, destroyed = false;
  let now = 0n, next = null;
  const boardState = () => {
    const state = board?.getDeviceState(partId);
    if (board && state?.machine?.model !== CARDIAC_MODEL) throw new Error(`CARDIAC part ${partId} is no longer on the attached Board.`);
    return state;
  };
  const machine = () => board ? boardState().machine : standalone;
  function schedule() {
    const m = machine();
    if (!m.running || m.waiting || m.halted || m.error) next = null;
    else if (next === null) next = now + period;
  }
  const adapter = {
    get machine() { return machine(); },
    get board() { return board; },
    get partId() { return partId; },
    timeNs: () => board ? board.timeNs : now,
    snapshot() {
      const view = snapshotCardiacMachine(machine());
      if (board) {
        const s = boardState();
        view.inputVoltage = s.inputVoltage; view.outputHigh = s.outputHigh;
        view.sampledInput = s.sampledInput ? {...s.sampledInput} : null;
      }
      return view;
    },
    attachBoard(nextBoard, selectedPart = options.partId) {
      if (destroyed) throw new Error('CARDIAC adapter has been destroyed.');
      if (!nextBoard || typeof nextBoard.getDeviceState !== 'function' ||
          typeof nextBoard.setDeviceControl !== 'function' || typeof nextBoard.advanceTo !== 'function' ||
          typeof nextBoard.timeNs !== 'bigint') throw new TypeError('CARDIAC attachment needs a Board with an existing CARDIAC part.');
      if (selectedPart === undefined) {
        const candidates = nextBoard.parts?.filter(p => p.kind === 'cardiac') ?? [];
        if (candidates.length !== 1) throw new Error('Select exactly one CARDIAC part with opts.partId.');
        selectedPart = candidates[0].id;
      }
      const selected = nextBoard.getDeviceState(selectedPart);
      if (selected?.machine?.model !== CARDIAC_MODEL) throw new Error(`Part ${selectedPart} is not a CARDIAC device.`);
      if (options.machine && selected.machine !== options.machine) throw new Error('The supplied CARDIAC machine is not owned by the selected Board part.');
      board = nextBoard; partId = selectedPart;
      return adapter;
    },
    control(verb, value) {
      if (destroyed) return false;
      if (board) return board.setDeviceControl(partId, verb, value);
      if (verb === 'sampleInput') return false; // sampling requires a solved IN terminal
      const handled = controlCardiacMachine(standalone, verb, value);
      if (['loadProgram', 'reset', 'restore', 'step', 'halt', 'pause', 'setPc'].includes(verb)) next = null;
      schedule();
      return handled;
    },
    loadProgram(image) { return adapter.control('loadProgram', image); },
    reset() { return adapter.control('reset'); },
    /** At most one due instruction; never advance the Board past that boundary. */
    advanceUntil(deadline) {
      if (destroyed) return {executed: 0, reason: 'detached'};
      const at = adapter.timeNs();
      if (typeof deadline !== 'bigint' || deadline < at) throw new RangeError('CARDIAC deadline must be a monotonic bigint nanosecond time.');
      const m = machine(), before = m.steps;
      if (!m.running || m.waiting || m.halted || m.error || deadline === at) return {executed: 0, reason: m.status};
      if (board) {
        const due = boardState()._nextInstructionNs;
        if (due === null) throw new Error('Running CARDIAC Board device has no instruction deadline.');
        board.advanceTo(due < deadline ? due : deadline);
      } else {
        schedule();
        if (next <= deadline) {
          now = next; next = null;
          stepCardiacMachine(m, {ignoreBreakpoint: false});
          schedule();
        } else now = deadline;
      }
      return {executed: m.steps - before, reason: m.status};
    },
    destroy() {
      if (destroyed) return;
      adapter.control('pause');
      destroyed = true; next = null;
    }
  };
  if (options.board) adapter.attachBoard(options.board, options.partId);
  return adapter;
}
