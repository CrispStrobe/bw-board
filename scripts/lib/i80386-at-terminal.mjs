const keyCodes={
  '1':2,'2':3,'3':4,'4':5,'5':6,'6':7,'7':8,'8':9,'9':10,'0':11,
  q:16,w:17,e:18,r:19,t:20,y:21,u:22,i:23,o:24,p:25,
  a:30,s:31,d:32,f:33,g:34,h:35,j:36,k:37,l:38,
  z:44,x:45,c:46,v:47,b:48,n:49,m:50,
  '-':12,'=':13,'[':26,']':27,'\\':43,';':39,"'":40,'`':41,
  ',':51,'.':52,'/':53,' ':57,
};
const shifted={
  '!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0',
  '_':'-','+':'=','{':'[','}':']','|':'\\',':':';','"':"'",'~':'`',
  '<':',','>':'.','?':'/',
};
const press=code=>[code,code|0x80];
const extended=code=>[0xe0,code,0xe0,code|0x80];

export function makeTerminalInputState() {
  return {pending:'',buttons:0,x:0,y:0,width:640,height:350,columns:80,rows:25,
    focused:true};
}

/** An isolated Escape key is indistinguishable from a split CSI until timeout. */
export function flushTerminalEscape(state) {
  if(state.pending!=='\x1b')return [];
  state.pending='';
  return press(1);
}

/** Decode a raw terminal chunk to Set-1 make/break bytes and PS/2 mouse input. */
export function decodeTerminalInput(state,chunk) {
  state.pending+=Buffer.isBuffer(chunk)?chunk.toString('latin1'):String(chunk);
  const scan=[],mouse=[];
  let quit=false,refresh=false,focusChanged=null;
  while(state.pending.length) {
    const text=state.pending;
    if(text[0]==='\x1b') {
      if(text.length===1)break;
      if(text.startsWith('\x1b[I')||text.startsWith('\x1b[O')) {
        state.focused=text[2]==='I';focusChanged=state.focused;
        state.pending=text.slice(3);continue;
      }
      const sgr=text.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if(sgr) {
        const button=Number(sgr[1]),column=Number(sgr[2]),row=Number(sgr[3]);
        const bit=[1,4,2][button&3]??0;
        if(sgr[4]==='m')state.buttons&=~bit;
        else if((button&3)===3)state.buttons=0;
        else if(!(button&64))state.buttons|=bit;
        const x=Math.max(0,Math.min(state.width-1,
          Math.round((column-1)*state.width/Math.max(1,state.columns-1))));
        const y=Math.max(0,Math.min(state.height-1,
          Math.round((row-2)*state.height/Math.max(1,state.rows-2))));
        mouse.push({dx:x-state.x,dy:y-state.y,buttons:state.buttons});
        state.x=x;state.y=y;
        state.pending=text.slice(sgr[0].length);continue;
      }
      const arrow=text.match(/^\x1b\[([ABCDHF])/);
      if(arrow) {
        const code={A:0x48,B:0x50,C:0x4d,D:0x4b,H:0x47,F:0x4f}[arrow[1]];
        scan.push(...extended(code));state.pending=text.slice(arrow[0].length);continue;
      }
      const csi=text.match(/^\x1b\[[0-9;]*[~A-Za-z]/);
      if(csi){state.pending=text.slice(csi[0].length);continue;}
      if(text.startsWith('\x1b[')&&!/[A-Za-z~mM]$/.test(text)&&text.length<64)break;
      // Most terminals encode Alt+printable as ESC followed by the character.
      // Send an actual Alt chord to the guest (for example Program Manager
      // Alt+F), instead of an Escape key followed by an unrelated letter.
      const meta=text[1];
      if(meta!=='\x1b'&&meta!=='O') {
        const lower=meta.toLowerCase(),base=shifted[meta]??lower;
        const code=keyCodes[base];
        if(code!==undefined) {
          const shift=shifted[meta]!==undefined||(meta!==lower&&/[A-Z]/.test(meta));
          scan.push(0x38);
          if(shift)scan.push(0x2a);
          scan.push(...press(code));
          if(shift)scan.push(0xaa);
          scan.push(0xb8);
          state.pending=text.slice(2);continue;
        }
      }
      scan.push(...press(1));state.pending=text.slice(1);continue;
    }
    const ch=text[0];state.pending=text.slice(1);
    if(ch==='\x1d'){quit=true;continue;}
    if(ch==='\x0c'){refresh=true;continue;}
    if(ch==='\r'||ch==='\n'){scan.push(...press(0x1c));continue;}
    if(ch==='\x7f'||ch==='\x08'){scan.push(...press(0x0e));continue;}
    if(ch==='\t'){scan.push(...press(0x0f));continue;}
    if(ch.charCodeAt(0)>=1&&ch.charCodeAt(0)<=26) {
      const letter=String.fromCharCode(96+ch.charCodeAt(0));
      const code=keyCodes[letter];
      if(code!==undefined)scan.push(0x1d,...press(code),0x9d);
      continue;
    }
    const lower=ch.toLowerCase();
    const base=shifted[ch]??lower;
    const code=keyCodes[base];
    if(code===undefined)continue;
    const shift=shifted[ch]!==undefined||(ch!==lower&&/[A-Z]/.test(ch));
    if(shift)scan.push(0x2a);
    scan.push(...press(code));
    if(shift)scan.push(0xaa);
  }
  return {scan,mouse,quit,refresh,focusChanged};
}

export function ansiTextFrame(lines,columns=80,rows=25) {
  const width=Math.max(1,Math.min(160,columns));
  return Array.from({length:Math.max(1,Math.min(50,rows))},(_,index)=>
    (lines[index]??'').slice(0,width).replace(/[\x00-\x1f\x7f-\x9f]/g,' ')
      .padEnd(width,' ')).join('\n');
}

/** Downsample a decoded RGB frame to true-color terminal half blocks. */
export function ansiRgbFrame(frame,columns=80,rows=25) {
  const width=Math.max(1,Math.min(columns,120)),height=Math.max(1,Math.min(rows,50));
  const pixel=(x,y)=>{
    const sx=Math.min(frame.width-1,Math.floor((x+0.5)*frame.width/width));
    const sy=Math.min(frame.height-1,Math.floor((y+0.5)*frame.height/(height*2)));
    const at=(sy*frame.width+sx)*3;
    return [frame.rgb[at],frame.rgb[at+1],frame.rgb[at+2]];
  };
  const lines=[];
  for(let row=0;row<height;row++) {
    let line='';
    for(let col=0;col<width;col++) {
      const upper=pixel(col,row*2),lower=pixel(col,row*2+1);
      line+=`\x1b[38;2;${upper.join(';')}m\x1b[48;2;${lower.join(';')}m▀`;
    }
    lines.push(line+'\x1b[0m');
  }
  return lines.join('\n');
}
