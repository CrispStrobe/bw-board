// Expand an explicit measurement inventory through static local module imports.
// Paths are returned relative to scripts/ for the report's committed-source map.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const staticImport=/\b(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g;
const dynamicLiteralImport=/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

export function expandI80386SourceInventory(seeds,scriptUrl){
  const scriptDir=path.dirname(fileURLToPath(scriptUrl));
  const found=new Set(),queue=seeds.map(seed=>path.resolve(scriptDir,seed));
  while(queue.length){
    const file=queue.pop();
    if(found.has(file))continue;
    const source=fs.readFileSync(file);
    found.add(file);
    if(!/\.(?:mjs|js)$/.test(file))continue;
    const text=source.toString('utf8');
    for(const pattern of [staticImport,dynamicLiteralImport]){
      pattern.lastIndex=0;
      let match;
      while((match=pattern.exec(text))!==null)
        queue.push(path.resolve(path.dirname(file),match[1]));
    }
  }
  return [...found].map(file=>{
    const relative=path.relative(scriptDir,file).split(path.sep).join('/');
    return relative.startsWith('..')?relative:`./${relative}`;
  }).sort();
}
