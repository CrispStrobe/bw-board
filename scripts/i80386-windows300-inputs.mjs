export const validateWindowsParentReport = (bytes, hddSha256) => {
  const report = JSON.parse(bytes);
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      report.schema !== 'astra.i80386-windows300-diagnostic.v1' ||
      report.hddOutputSha256 !== hddSha256)
    throw new Error('derived HDD parent report does not produce the supplied image');
  return report;
};

const scan = {alt:0x38,ctrl:0x1d,shift:0x2a,enter:0x1c,space:0x39,'.':0x34,'\\':0x2b,';':0x27,
  '0':0x0b,'1':0x02,'2':0x03,'3':0x04,'4':0x05,'5':0x06,'6':0x07,'7':0x08,'8':0x09,'9':0x0a,
  a:0x1e,b:0x30,c:0x2e,d:0x20,e:0x12,f:0x21,g:0x22,h:0x23,i:0x17,j:0x24,k:0x25,l:0x26,
  m:0x32,n:0x31,o:0x18,p:0x19,q:0x10,r:0x13,s:0x1f,t:0x14,u:0x16,v:0x2f,w:0x11,x:0x2d,y:0x15,z:0x2c};

export const parseWindowsKeyScript = (bytes, stepLimit) => {
  const script = JSON.parse(bytes);
  if (!script || typeof script !== 'object' || Array.isArray(script) ||
      script.schema !== 'astra.windows-key-script.v1' || !Array.isArray(script.actions) ||
      script.actions.length === 0)
    throw new Error('invalid Windows key script');

  const events = [];
  const emitStroke = (step, key, shift = false) => {
    if (!Object.hasOwn(scan, key)) throw new Error(`unsupported key '${key}'`);
    const code = scan[key];
    if (shift) events.push({step, code: scan.shift});
    events.push({step: step + 100, code}, {step: step + 200, code: code | 0x80});
    if (shift) events.push({step: step + 300, code: scan.shift | 0x80});
  };

  for (const action of script.actions) {
    if (!Number.isInteger(action.step) || action.step < 1)
      throw new Error('key action step must be positive');
    if (action.kind === 'key') emitStroke(action.step, action.key);
    else if (action.kind === 'chord') {
      const keys = action.keys;
      if (!Array.isArray(keys) || keys.length < 2) throw new Error('invalid chord');
      if (keys.some(key => !Object.hasOwn(scan, key))) throw new Error('unsupported chord key');
      let at = action.step;
      for (const key of keys.slice(0, -1)) events.push({step: at += 100, code: scan[key]});
      const code = scan[keys.at(-1)];
      events.push({step: at += 100, code}, {step: at += 100, code: code | 0x80});
      for (const key of keys.slice(0, -1).reverse())
        events.push({step: at += 100, code: scan[key] | 0x80});
    } else if (action.kind === 'text') {
      if (typeof action.value !== 'string' || action.value.length === 0)
        throw new Error('key text must be nonempty');
      let at = action.step;
      const interval = action.interval ?? 1000;
      if (!Number.isInteger(interval) || interval < 400)
        throw new Error('key text interval must be an integer >=400');
      for (const char of action.value) {
        const lower = char.toLowerCase();
        emitStroke(at, char === ':' ? ';' : char === ' ' ? 'space' : lower,
          char !== lower || char === ':');
        at += interval;
      }
    } else throw new Error(`unsupported key action '${action.kind}'`);
  }
  events.sort((a, b) => a.step - b.step);
  if (events.some((event, index) => event.step >= stepLimit ||
      (index && event.step <= events[index - 1].step)) ||
      events.at(-1).step + 10_000_000 >= stepLimit)
    throw new Error('key events must be unique and precede the instruction limit');
  return {script, events};
};
