import {SUCCESS, FAILURE, EXIT_OK, RETURN} from './media.mjs';
import {FIRST_COMMAND, SECOND_COMMAND} from './media.mjs';
import {encode} from './keyboard.mjs';

const MAX_STEPS = 120_000_000;
export const prompt = lines => /^[A-Z]:\\>$/.test(
  [...lines].reverse().find(line=>line.trim())?.trim()??'');

export function retainFailure(report, detail) {
  if(report.firstFailure===null)report.firstFailure=detail;
  else report.secondaryFailure=detail;
}

function contains(whole,part) {
  for(let at=0;at<=whole.length-part.length;at++)
    if(part.every((scan,index)=>whole[at+index]===scan))return at;
  return -1;
}

export function evaluate({witness,files,screen,returned,shutdown,steps,keyboard}) {
  const address=witness.entry?.linear;
  const accepted=keyboard?.injected?.filter(event=>event.accepted).map(event=>event.scan)??[];
  const first=encode(FIRST_COMMAND+'\r').map(event=>event.scan);
  const second=encode(SECOND_COMMAND+'\r').map(event=>event.scan);
  const firstAt=contains(accepted,first);
  const secondAt=contains(accepted,second);
  const checks={
    bounded: steps>0&&steps<MAX_STEPS&&!shutdown,
    protectedEntry: !!witness.entry && witness.entry.csDefault32===true &&
      witness.entry.ssDefault32===true && witness.entry.ssWritable===true && (witness.entry.cr0&1)!==0,
    arithmetic: witness.cmp?.eax===0x23456789,
    branch: witness.branch?.zero===true,
    print: witness.print?.ah===9 && witness.print?.edx===address+57,
    exit: witness.exit?.ax===0x4c00,
    output: files.output?.text.includes(SUCCESS)===true && !files.output.text.includes(FAILURE),
    exitFile: files.ok?.text.includes(EXIT_OK)===true && files.fail===null,
    shellReturn: files.returned?.text.includes(RETURN)===true && returned && prompt(screen),
    keyboard: keyboard?.pending===0 && firstAt>=0 && secondAt>=firstAt+first.length,
  };
  return {checks,passed:Object.values(checks).every(Boolean)};
}
