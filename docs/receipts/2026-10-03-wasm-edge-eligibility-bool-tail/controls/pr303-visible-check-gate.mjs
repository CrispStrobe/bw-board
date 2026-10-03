export function readyVisibleChecks (checks, baselineCore) {
    if (checks.length !== 13 || checks.some(c => c.status !== 'COMPLETED')) return false;
    const success = checks.filter(c => c.conclusion === 'SUCCESS');
    const skipped = checks.filter(c => c.conclusion === 'SKIPPED');
    if (success.length !== 11 || skipped.length !== 2 || skipped.some(c => c.name !== 'vectors-full')) return false;
    return ['test', 'vectors', 'corpus', 'vectors186', 'qualify'].every(name =>
        success.filter(c => c.name === name).length === 2) &&
        success.filter(c => c.name === 'Inspect edge layout ' + baselineCore).length === 1;
}
