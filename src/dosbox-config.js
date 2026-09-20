/** Parse the declarative DOSBox config subset; never executes host commands. */
export function parseDosboxConfig(text) {
  const sections = {}; let section = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, '').trim(); if (!line) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1].trim().toLowerCase(); sections[section] ||= {}; continue; }
    const eq = line.indexOf('=');
    if (eq >= 0) { sections[section] ||= {}; sections[section][line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim(); }
    else if (section === 'autoexec') { sections.autoexec ||= {}; (sections.autoexec.__lines ||= []).push(line); }
  }
  const autoexec = sections.autoexec?.__lines || [];
  const mounts = [], boots = [];
  for (const command of autoexec) {
    let m = command.match(/^mount\s+([a-z]):?\s+(.+?)(?:\s+-t\s+(\S+))?$/i);
    if (m) { mounts.push({ drive: m[1].toLowerCase(), source: m[2].replace(/^"|"$/g, ''), type: m[3]?.toLowerCase() || 'dir' }); continue; }
    m = command.match(/^imgmount\s+([a-z]):?\s+(\S+)(?:\s+-t\s+(\S+))?/i);
    if (m) mounts.push({ drive: m[1].toLowerCase(), source: m[2].replace(/^"|"$/g, ''), type: m[3]?.toLowerCase() || 'hdd' });
    m = command.match(/^boot\s+(.+)$/i); if (m) boots.push(m[1].trim().replace(/^"|"$/g, ''));
  }
  return { sections, mounts, boots, autoexec };
}
export function resolveDosboxMedia(config, files = {}) {
  const result = { images: [], missing: [], refused: [] };
  for (const mount of config?.mounts || []) {
    if (mount.type === 'dir') { result.refused.push({ source: mount.source, reason: 'host directory mounts are not browser media' }); continue; }
    const key = mount.source.split(/[\\/]/).pop();
    if (!files[key]) result.missing.push(key); else result.images.push({ drive: mount.drive, type: mount.type, name: key, bytes: files[key] });
  }
  for (const boot of config?.boots || []) { const key = boot.split(/[\\/]/).pop(); if (!files[key] && !result.missing.includes(key)) result.missing.push(key); }
  return result;
}
