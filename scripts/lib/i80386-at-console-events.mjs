/** Ordered, deterministic host input for the experimental 386 AT CLI. */
export function parseAtConsoleEvents(bytes,limit) {
  const events=JSON.parse(Buffer.isBuffer(bytes)?bytes.toString('utf8'):bytes);
  if(!Array.isArray(events))throw new Error('AT_CONSOLE_EVENTS must be a JSON array');
  for(let index=0;index<events.length;index++) {
    const event=events[index];
    if(!event||!Number.isInteger(event.step)||event.step<0||event.step>=limit||
        (index>0&&event.step<events[index-1].step))
      throw new Error('console events need ordered steps inside the run budget');
    if(event.type==='key'||event.type==='serial') {
      if(!Number.isInteger(event.code)||event.code<0||event.code>255)
        throw new Error(`${event.type} event needs byte code`);
    } else if(event.type==='mouse') {
      for(const name of ['dx','dy','buttons'])if(!Number.isInteger(event[name]))
        throw new Error(`mouse event needs integer ${name}`);
      if(event.buttons<0||event.buttons>7)
        throw new Error('mouse buttons must be a three-bit mask');
    } else throw new Error('console event type must be key, serial, or mouse');
  }
  return events;
}
