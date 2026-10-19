/** MIT. Conservative, codec-independent raw-HDD package policy. */
import {parseDosboxConfig} from './dosbox-config.js';

export const DOS_PACKAGE_LIMITS = Object.freeze({
  archiveBytes: 16 * 1024 * 1024, entries: 32,
  fileBytes: 16 * 1024 * 1024, totalBytes: 16 * 1024 * 1024,
  configBytes: 16 * 1024, pathBytes: 128, expansionRatio: 1,
});

export function canonicalDosPackagePath(path, directory = false) {
  if (typeof path !== 'string' || !path.length || path.length > DOS_PACKAGE_LIMITS.pathBytes ||
      !/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith('/') || path.includes('//'))
    throw new Error('package path must be a bounded relative ASCII path');
  const body = directory && path.endsWith('/') ? path.slice(0, -1) : path;
  if (!body.length || body.split('/').some(part => !part.length || part === '.' || part === '..' ||
      !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part) || part.endsWith('.') ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw new Error('package path is not canonical');
  return body;
}

export function validateDosPackageNames(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > DOS_PACKAGE_LIMITS.entries)
    throw new Error('package entry count exceeds policy');
  const seen = new Map();
  for (const entry of entries) {
    const path = canonicalDosPackagePath(entry.name, entry.directory === true), key = path.toLowerCase();
    if (seen.has(key)) throw new Error('duplicate or case-alias package path');
    seen.set(key, {path, directory: entry.directory === true});
  }
  for (const {path} of seen.values()) {
    const parts = path.split('/');
    while (parts.length > 1) {
      parts.pop();
      const ancestor = seen.get(parts.join('/').toLowerCase());
      if (ancestor && (!ancestor.directory || ancestor.path !== parts.join('/')))
        throw new Error('conflicting package ancestor path');
    }
  }
  // Also reject implicit directory spelling aliases (A/x plus a/y).
  const directories = new Map();
  for (const {path, directory} of seen.values()) {
    const parts = path.split('/');
    if (!directory) parts.pop();
    while (parts.length) {
      const full = parts.join('/'), key = full.toLowerCase();
      if (directories.has(key) && directories.get(key) !== full)
        throw new Error('case-alias package ancestor');
      directories.set(key, full); parts.pop();
    }
  }
}

/** Only optional [cpu] cputype=386|auto, then [autoexec] with
 * imgmount (2|c) REL.img -t hdd -size 512,S,H,C
 * boot -l c
 * are supported, in that order. Blank/whole-line #/; comments are allowed.
 */
export function parseDosPackageConfig(text, configPath) {
  canonicalDosPackagePath(configPath);
  if (typeof text !== 'string' || text.length > DOS_PACKAGE_LIMITS.configBytes ||
      /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) throw new Error('package config must be bounded ASCII');
  let section = '', cpu = false, autoexec = false, mount = null, boot = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[#;]/.test(line)) continue;
    if (line.toLowerCase() === '[cpu]') {
      if (section || cpu || autoexec) throw new Error('duplicate or misplaced package CPU section');
      section = 'cpu'; continue;
    }
    if (line.toLowerCase() === '[autoexec]') {
      if (autoexec || section === 'cpu' && !cpu) throw new Error('duplicate or empty package config section');
      autoexec = true; section = 'autoexec'; continue;
    }
    if (section === 'cpu' && !cpu && /^cputype\s*=\s*(386|auto)$/i.test(line)) {
      cpu = true; continue;
    }
    if (section !== 'autoexec' || /[&|<>^`$;#]/.test(line))
      throw new Error('unsupported package config declaration');
    // Quotes belong only around the complete path token. Other tokens are
    // lexical declarations, not shell-style token concatenation or expansion.
    const mountLine = line.match(/^imgmount[\t ]+(2|c)[\t ]+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s"']+))[\t ]+-t[\t ]+hdd[\t ]+-size[\t ]+(512,[1-9][0-9]*,[1-9][0-9]*,[1-9][0-9]*)$/i);
    if (mountLine) {
      if (mount || boot)
        throw new Error('package needs one primary HDD imgmount with declared options');
      const image = canonicalDosPackagePath((mountLine[2] ?? mountLine[3] ?? mountLine[4]).replace(/\\/g, '/'));
      if (!/\.img$/i.test(image)) throw new Error('only raw .img package media is supported');
      const [, sectors, heads, cylinders] = mountLine[5].split(',').map(Number);
      if (sectors > 63 || heads > 16 || cylinders > 1024 ||
          cylinders * heads * sectors * 512 > DOS_PACKAGE_LIMITS.fileBytes)
        throw new Error('package HDD geometry exceeds bounds');
      mount = {image, geometry: Object.freeze({cylinders, heads, sectors})};
    } else if (/^boot[\t ]+-l[\t ]+c$/i.test(line)) {
      if (!mount || boot) throw new Error('package boot must select the declared primary HDD');
      boot = true;
    } else throw new Error('unsupported package command');
  }
  if (!mount || !boot) throw new Error('package needs one HDD mount and one boot declaration');
  const canonical = parseDosboxConfig(text);
  if (canonical.mounts.length !== 1 || canonical.mounts[0].drive !== 'c' ||
      canonical.mounts[0].type !== 'hdd' || canonical.mounts[0].source.replace(/\\/g, '/') !== mount.image ||
      canonical.boots.length !== 1 || !/^-l\s+c$/i.test(canonical.boots[0]) ||
      canonical.autoexec.length !== 2)
    throw new Error('canonical DOSBox parser disagrees with package declaration');
  const prefix = configPath.includes('/') ? configPath.slice(0, configPath.lastIndexOf('/') + 1) : '';
  const imagePath = canonicalDosPackagePath(prefix + mount.image);
  return Object.freeze({route: 'i80386-at-hdd', configPath, imagePath, geometry: mount.geometry});
}

/** Archive is a read-only adapter: names and read(name), returning fresh bytes. */
export function selectDosPackage(archive, selectedConfig = null) {
  const names = archive.names;
  validateDosPackageNames(names.map(name => ({name, directory: false})));
  let configPath = selectedConfig;
  if (configPath !== null) canonicalDosPackagePath(configPath);
  else {
    const defaults = names.filter(name => name.split('/').at(-1).toLowerCase() === 'dosbox.conf');
    if (defaults.length !== 1) throw new Error('select one explicit config or one unambiguous dosbox.conf');
    [configPath] = defaults;
  }
  const lookup = path => names.find(name => name.toLowerCase() === path.toLowerCase());
  configPath = lookup(configPath);
  if (!configPath) throw new Error('selected package config is absent');
  const bytes = archive.read(configPath);
  if (bytes.length > DOS_PACKAGE_LIMITS.configBytes) throw new Error('package config exceeds size cap');
  if (bytes.some(byte => byte > 127)) throw new Error('package config must be ASCII');
  const text = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  const policy = parseDosPackageConfig(text, configPath), imagePath = lookup(policy.imagePath);
  if (!imagePath) throw new Error('declared package HDD asset is absent');
  if (names.some(name => name !== configPath && name !== imagePath &&
      !/(?:^|\/)LICENSE\.txt$/i.test(name))) throw new Error('package has an undeclared file or extra config');
  const image = Uint8Array.from(archive.read(imagePath)), {cylinders, heads, sectors} = policy.geometry;
  if (image.length !== cylinders * heads * sectors * 512)
    throw new Error('package HDD image extent must exactly match CHS');
  // Expose snapshots through accessors; callers cannot mutate later consumers.
  return Object.freeze({...policy, imagePath, configText: text, imageByteLength: image.length,
    readImage: () => image.slice()});
}
