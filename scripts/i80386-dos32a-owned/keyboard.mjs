// Set-1 key down/up events. Keep the exact offered bytes for the guest receipt.
const make = {a:0x1e,b:0x30,c:0x2e,d:0x20,e:0x12,f:0x21,g:0x22,h:0x23,i:0x17,
  j:0x24,k:0x25,l:0x26,m:0x32,n:0x31,o:0x18,p:0x19,q:0x10,r:0x13,s:0x1f,
  t:0x14,u:0x16,v:0x2f,w:0x11,x:0x2d,y:0x15,z:0x2c,' ':0x39,'\r':0x1c,
  '0':0x0b,'1':0x02,'2':0x03,'3':0x04,'4':0x05,'5':0x06,'6':0x07,'7':0x08,
  '8':0x09,'9':0x0a,'-':0x0c,'.':0x34,'\\':0x2b,':':0x27};

export function encode(text) {
  const events=[];
  for (const ch of text) {
    const code=make[ch.toLowerCase()];
    if (code===undefined) throw new Error(`unsupported guest key ${JSON.stringify(ch)}`);
    if (ch===':') events.push({key:'shift',phase:'make',scan:0x2a});
    events.push({key:ch,phase:'make',scan:code},{key:ch,phase:'break',scan:code|0x80});
    if (ch===':') events.push({key:'shift',phase:'break',scan:0xaa});
  }
  return events;
}

// The BIOS data-area queue can be empty before the 8042 has delivered its
// pending byte. Both must be clear, with a bounded instruction gap between
// offers, so one command cannot be burst into the controller.
export function readyForScan({step,lastAcceptedStep,ringEmpty,controllerStatus}) {
  return step-lastAcceptedStep>=5_000 && ringEmpty && (controllerStatus&1)===0;
}
