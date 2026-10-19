export function fast286Verdict(report) {
    const integer = name => Number.isSafeInteger(report[name]) && report[name] >= 0;
    const fields = ['files', 'available', 'selected', 'executed', 'pass', 'fail',
        'unsupported', 'budget', 'revoked'];
    if (!fields.every(integer)) return {accepted: false, reason: 'invalid-counts'};
    if (report.files < 1 || report.available < 1 || report.selected < 1 || report.executed < 1) {
        return {accepted: false, reason: 'empty-selection'};
    }
    if (report.selected > report.available) return {accepted: false, reason: 'selection-overflow'};
    if (report.fullSuite && report.selected !== report.available) {
        return {accepted: false, reason: 'incomplete-full-suite'};
    }
    if (report.pass + report.fail + report.unsupported + report.budget !== report.executed) {
        return {accepted: false, reason: 'result-count-mismatch'};
    }
    if (report.executed + report.revoked !== report.selected) {
        return {accepted: false, reason: 'selection-count-mismatch'};
    }
    if (report.fail || report.unsupported || report.budget) {
        return {accepted: false, reason: 'non-pass-results'};
    }
    return {accepted: true, reason: 'all-executed-vectors-pass'};
}

export const fast286ExitCode = report => fast286Verdict(report).accepted ? 0 : 1;
