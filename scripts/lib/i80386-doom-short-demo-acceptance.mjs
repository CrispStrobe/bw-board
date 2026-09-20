import {renderObservedDoomVga} from './i80386-doom-vga-frame.mjs';

export const SHORT_DEMO_EXPECTED={
  executionRevision:'d1262ff4d1abe340dea8c7cb53b31af7e91111e6',
  imageSha256:'5ffd1e792e80f5412b713413cd760f4114b6f1d9c527292369c806b716102a8d',
  doomExeSha256:'b8020523561a5ad9706e009a52d61c578f37faafd85ac471962308406292ce27',
  doomWadSha256:'1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771',
  command:'n\rc:\rdoom -timedemo astra -nosound\r'
};

export function gradeI80386DoomShortDemo(report) {
  let frame=null;
  try { frame=renderObservedDoomVga(report?.vgaEvidence?.latestGraphicsSnapshot); } catch {}
  const lines=Array.isArray(report?.screenText)?report.screenText:[];
  const nonblank=lines.map(line=>String(line).trim()).filter(Boolean);
  const completion=nonblank.find(line=>/^timed 24 gametics in [1-9][0-9]* realtics$/.test(line))??null;
  const predicates={
    boundedSuccess:report?.passed===true&&report?.stopReason===null&&report?.hostRefusal===null,
    returnedNormally:report?.final?.halted===false&&report?.final?.shutdown===false&&nonblank.at(-1)==='C:\\>',
    exactExecution:report?.executionRevision===SHORT_DEMO_EXPECTED.executionRevision,
    exactMedia:report?.hdd?.inputSha256===SHORT_DEMO_EXPECTED.imageSha256&&
      report?.hdd?.outputSha256===SHORT_DEMO_EXPECTED.imageSha256,
    exactGame:report?.hdd?.files?.doomExe?.sha256===SHORT_DEMO_EXPECTED.doomExeSha256&&
      report?.hdd?.files?.doomWad?.sha256===SHORT_DEMO_EXPECTED.doomWadSha256,
    exactCommand:report?.keyboardScript?.requested===SHORT_DEMO_EXPECTED.command&&
      report?.keyboardScript?.commandQueued===true,
    guestCompletion:completion!==null,
    renderedFrame:frame!==null&&frame.width===320&&frame.height===200&&frame.uniqueRgbColors>1
  };
  return {accepted:Object.values(predicates).every(Boolean),predicates,completion,
    frame:frame&&{step:report.vgaEvidence.latestGraphicsSnapshot.step,
      uniqueRgbColors:frame.uniqueRgbColors,indexSha256:frame.indexSha256,rgbSha256:frame.rgbSha256}};
}
