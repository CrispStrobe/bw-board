export function gradeFreeDosAtAcceptance(evidence, {
  expectedText,
  inputBootSectorSha256,
  inputMediaSha256,
  originalMediaSha256,
  priorOutputMediaSha256 = null,
  expectedRequested,
  expectedInjectedKeys,
} = {}) {
  const boot = evidence.executionBoundaries?.bootSector;
  const dma = boot?.devices?.primaryDma;
  const channel = dma?.channels?.[2];
  const lines = evidence.screenText ?? [];
  const lastLine = [...lines].reverse().find(line => line.trim() !== '') ?? '';
  const dmaSector = channel?.page === 0 && channel.baseAddr === 0x7c00 &&
    channel.baseCount === 0x1ff && channel.curAddr === 0x7e00 &&
    channel.curCount === 0xffff && (dma.status & 4) !== 0;
  const keys = evidence.keyboardScript;
  const injectedKeys = keys?.injected?.map(event => event.key) ?? [];
  const mediaAdmitted = priorOutputMediaSha256 === null
    ? inputMediaSha256 === originalMediaSha256
    : inputMediaSha256 === priorOutputMediaSha256;
  return !!evidence.passed && !evidence.final?.halted && !evidence.final?.shutdown &&
    !!evidence.executionBoundaries?.int19 && !!boot &&
    !evidence.executionBoundaries?.unexpectedInterrupt &&
    boot.sha256 === inputBootSectorSha256 && dmaSector && mediaAdmitted &&
    keys?.installerDeclined === true && keys?.commandQueued === true &&
    keys?.requested === expectedRequested && keys?.remaining?.length === 0 &&
    JSON.stringify(injectedKeys) === JSON.stringify(expectedInjectedKeys) &&
    evidence.guestFile?.text === expectedText &&
    lines.some(line => line === expectedText.trim()) && /^A:\\?>\s*$/.test(lastLine);
}
