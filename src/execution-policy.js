/** Pure admission only: no engine imports, loader calls, or running-target mutation. */
export const MACHINE_SEMANTICS = Object.freeze([
  'dos-services', 'functional-hardware', 'wired-digital'
]);

const text = value => typeof value === 'string' && value.length > 0;
const strings = value => Array.isArray(value) && Array.from(value).every(text) &&
  new Set(value).size === value.length;
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const compareIDs = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Build from an adapter-owned, reviewed catalog; never from project preferences.
 * Qualification/evidence are declarations by that trusted adapter, not verified
 * by this module. There are deliberately no built-in backend registrations.
 * See docs/EXECUTION-POLICY-API.md for the trust boundary and integration order.
 */
export function createExecutionPolicy (catalog) {
  if (!Array.isArray(catalog)) throw new TypeError('catalog must be an array');
  const ids = new Set();
  const entries = Array.from(catalog, entry => {
    if (!entry || !text(entry.id) || ids.has(entry.id) || !text(entry.family) ||
        !MACHINE_SEMANTICS.includes(entry.semantics) || !text(entry.implementation) ||
        !Number.isSafeInteger(entry.rank) || entry.rank < 0 ||
        !strings(entry.capabilities) || typeof entry.reference !== 'boolean' ||
        typeof entry.experimental !== 'boolean' ||
        !['qualified', 'pending', 'rejected'].includes(entry.qualification) ||
        (entry.evidence != null && !text(entry.evidence)) ||
        (entry.reason != null && !text(entry.reason)) ||
        (entry.qualification === 'qualified' && !text(entry.evidence)) ||
        (entry.qualification !== 'qualified' && !text(entry.reason))) {
      throw new TypeError('invalid or duplicate execution catalog entry');
    }
    ids.add(entry.id);
    // Copy only recognized fields: caller-owned arrays or extra metadata cannot
    // change admission after construction or be advertised as active capabilities.
    return freeze({id: entry.id, family: entry.family, semantics: entry.semantics,
      implementation: entry.implementation, rank: entry.rank,
      capabilities: [...entry.capabilities], reference: entry.reference,
      experimental: entry.experimental, qualification: entry.qualification,
      evidence: entry.evidence ?? null, reason: entry.reason ?? null});
  }).sort((a, b) => a.rank - b.rank || compareIDs(a, b));
  freeze(entries);

  return Object.freeze({
    /**
     * available IDs come from the adapter's actual provider/loader checks.
     * Omission is fail-closed. Selection is a plan for stop/rebuild, not execution.
     */
    select (request = {}, runtime = {}) {
      const invalid = () => freeze({accepted: false, code: 'invalid-request',
        reason: 'Specify valid semantics, family, mode, observations and available IDs.',
        requested: null, selected: null, restartRequired: false, refusals: []});
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          !runtime || typeof runtime !== 'object' || Array.isArray(runtime)) return invalid();
      const {family, semantics, mode = 'auto', implementationId = null,
        requiredCapabilities = [], allowExperimental = false} = request;
      const {available = []} = runtime;
      if (!text(family) || !MACHINE_SEMANTICS.includes(semantics) ||
          !['auto', 'reference', 'implementation'].includes(mode) ||
          (mode === 'implementation' ? !text(implementationId) : implementationId !== null) ||
          !strings(requiredCapabilities) || typeof allowExperimental !== 'boolean' ||
          !strings(available)) return invalid();
      const requested = {family, semantics, mode, implementationId,
        requiredCapabilities: [...requiredCapabilities], allowExperimental};
      const refuse = (code, reason, refusals = []) => freeze({accepted: false,
        code, reason, requested, selected: null, restartRequired: false, refusals});
      let candidates = entries;
      if (mode === 'implementation') {
        candidates = entries.filter(entry => entry.id === implementationId);
        if (!candidates.length) return refuse('unknown-implementation',
          'The requested implementation is not in the reviewed catalog.');
      } else {
        candidates = entries.filter(entry => entry.family === family &&
          entry.semantics === semantics && (mode !== 'reference' || entry.reference));
        if (!candidates.length) return refuse('no-matching-implementation',
          'No catalog implementation provides the requested machine and mode.');
      }
      const availableIDs = new Set(available);
      const refusals = [];
      for (const entry of candidates) {
        let code, reason;
        if (entry.family !== family) {
          code = 'family-mismatch'; reason = 'Implementation belongs to another CPU family.';
        } else if (entry.semantics !== semantics) {
          code = 'semantics-mismatch'; reason = 'Implementation provides a different machine.';
        } else if (entry.qualification !== 'qualified') {
          code = entry.qualification === 'rejected' ? 'candidate-rejected' : 'candidate-unqualified';
          reason = entry.reason;
        } else if (entry.experimental && (!allowExperimental || mode !== 'implementation')) {
          code = 'experimental-opt-in-required';
          reason = 'Experimental implementations need an explicit ID and experimental opt-in.';
        } else if (!availableIDs.has(entry.id)) {
          code = 'implementation-unavailable'; reason = 'The adapter has not reported an available loader/provider.';
        } else {
          const missing = requiredCapabilities.filter(capability => !entry.capabilities.includes(capability));
          if (missing.length) {
            code = 'missing-capability'; reason = `Unsupported observations: ${missing.join(', ')}.`;
          }
        }
        if (code) {
          refusals.push({id: entry.id, code, reason});
          continue;
        }
        return freeze({accepted: true, code: 'selected', requested,
          selected: {...entry, capabilities: [...entry.capabilities]},
          reason: mode === 'auto' ? 'First eligible implementation in reviewed rank/ID order.' :
            mode === 'reference' ? 'Qualified reference implementation requested explicitly.' :
              'Qualified implementation requested explicitly.',
          restartRequired: true, refusals});
      }
      return refuse(mode === 'implementation' ? refusals[0].code : 'no-eligible-implementation',
        mode === 'implementation' ? refusals[0].reason :
          'No implementation satisfies all admission requirements.', refusals);
    }
  });
}
