const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');
const YAML = require('yaml');
const { makeReadme } = require('./readme.cjs');

const sessions = new Map();
function getVoicebankRoot(id) { return sessions.get(id)?.root || null; }

async function findReadFiles(id) {
  const root = getVoicebankRoot(id);
  if (!root) throw new Error('音源を開き直してください');
  if (await fs.realpath(root) !== root) throw new Error('音源フォルダが変更されました');
  const found = [];
  const pending = [root];
  let scanned = 0;
  while (pending.length) {
    const directory = pending.pop();
    const directoryStat = await fs.lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue;
    const resolvedDirectory = await fs.realpath(directory);
    const directoryRelative = path.relative(root, resolvedDirectory);
    if (directoryRelative.startsWith('..') || path.isAbsolute(directoryRelative)) continue;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++scanned > 100000) throw new Error('ファイル数が上限を超えたため、$readの検出を中止しました');
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.toLowerCase() === '$read') {
        const stat = await fs.lstat(full);
        if (stat.isFile() && !stat.isSymbolicLink()) found.push({ path: path.relative(root, full).replace(/\\/g, '/'), size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function deleteReadFiles(id, expected) {
  const root = getVoicebankRoot(id);
  if (!root || !Array.isArray(expected) || await fs.realpath(root) !== root) throw new Error('音源を開き直してください');
  const current = await findReadFiles(id);
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('$readの状態が変更されました。再読み込みしてください');
  for (const item of current) {
    const target = path.resolve(root, item.path);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.basename(target).toLowerCase() !== '$read') throw new Error('削除対象を確認してください');
    const parent = await fs.realpath(path.dirname(target));
    const parentRelative = path.relative(root, parent);
    if (parentRelative.startsWith('..') || path.isAbsolute(parentRelative)) throw new Error('音源フォルダ外のファイルは削除できません');
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.size || stat.mtimeMs !== item.mtimeMs) throw new Error('$readの状態が変更されました。再読み込みしてください');
  }
  for (const item of current) await fs.unlink(path.resolve(root, item.path));
  return { deleted: current.length, readFiles: await findReadFiles(id) };
}

async function listVoicebankFiles(id) {
  const root = getVoicebankRoot(id);
  if (!root) throw new Error('音源を開き直してください');
  let count = 0;
  let truncated = false;
  async function walk(directory, name) {
    const node = { name, type: 'directory', children: [] };
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { return node; }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'ja', { numeric: true }));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (++count > 50000) { truncated = true; break; }
      if (entry.isDirectory()) node.children.push(await walk(path.join(directory, entry.name), entry.name));
      else if (entry.isFile()) node.children.push({ name: entry.name, type: 'file' });
    }
    return node;
  }
  return { tree: await walk(root, path.basename(root)), count: Math.min(count, 50000), truncated };
}

async function readVoiceColors(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  const yaml = await readYamlFile(session.yamlPath);
  const warnings = yaml.doc.errors.map(error => error.message);
  if (yaml.doc.contents && !YAML.isMap(yaml.doc.contents)) warnings.push('character.yamlの形式を確認してください');
  const rows = [];
  if (!warnings.length) {
    const subbanks = yaml.doc.toJS()?.subbanks;
    if (subbanks != null && !Array.isArray(subbanks)) warnings.push('subbanksの形式を確認してください');
    else for (const [index, row] of (subbanks || []).entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) { warnings.push(`subbanks ${index + 1}行目を確認してください`); continue; }
      const ranges = row.tone_ranges;
      if (!Array.isArray(ranges) || ranges.some(value => typeof value !== 'string')) { warnings.push(`subbanks ${index + 1}行目のtone_rangesを確認してください`); continue; }
      rows.push({ color: typeof row.color === 'string' ? row.color : '', prefix: typeof row.prefix === 'string' ? row.prefix : '', suffix: typeof row.suffix === 'string' ? row.suffix : '', toneRanges: ranges });
    }
  }
  return { exists: yaml.exists, writable: warnings.length === 0, rows, warnings };
}

async function saveVoiceColors(id, rows) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  if (!Array.isArray(rows) || rows.length > 512) throw new Error('VoiceColorの設定数を確認してください');
  const notePattern = /^([A-Ga-g][#b]?-?\d)-([A-Ga-g][#b]?-?\d)$/;
  for (const row of rows) {
    if (!row || ['color', 'prefix', 'suffix'].some(key => typeof row[key] !== 'string' || /[\r\n\t]/.test(row[key])) || !Array.isArray(row.toneRanges) || !row.toneRanges.length || row.toneRanges.length > 128) throw new Error('VoiceColorの設定を確認してください');
    for (const range of row.toneRanges) {
      const match = typeof range === 'string' ? notePattern.exec(range) : null;
      if (!match || noteToMidi(match[1]) === null || noteToMidi(match[2]) === null || noteToMidi(match[1]) > noteToMidi(match[2])) throw new Error('VoiceColorの音域を確認してください');
    }
  }
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  const yaml = await readYamlFile(session.yamlPath);
  if (hash(yaml.raw) !== session.yamlSnapshot) throw new Error('外部でcharacter.yamlが変更されました。音源を開き直してください');
  if (yaml.doc.errors.length || (yaml.doc.contents && !YAML.isMap(yaml.doc.contents))) throw new Error('character.yamlを安全に編集できません');
  const oldRows = yaml.doc.toJS()?.subbanks;
  if (oldRows != null && !Array.isArray(oldRows)) throw new Error('subbanksの形式を確認してください');
  const merged = rows.map(row => {
    const source = (oldRows || []).find(item => item && item.color === row.color && item.prefix === row.prefix && item.suffix === row.suffix && Array.isArray(item.tone_ranges) && item.tone_ranges.some(range => row.toneRanges.includes(range)));
    const extras = source ? Object.fromEntries(Object.entries(source).filter(([key]) => !['color', 'prefix', 'suffix', 'tone_ranges'].includes(key))) : {};
    return { ...extras, color: row.color, prefix: row.prefix, suffix: row.suffix, tone_ranges: row.toneRanges };
  });
  yaml.doc.set('subbanks', merged);
  const output = yaml.doc.toString({ lineWidth: 0 });
  const updated = yaml.source.includes('\r\n') ? output.replace(/\n/g, '\r\n') : output;
  const next = Buffer.concat([yaml.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(updated)]);
  if (next.equals(yaml.raw)) return { saved: false, message: '変更はありません', rows };
  const temp = path.join(session.root, `.character.yaml.tmp-${crypto.randomUUID()}`);
  try { await fs.writeFile(temp, next, { flag: 'wx' }); await fs.rename(temp, session.yamlPath); }
  catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  session.yamlSnapshot = hash(next);
  if (session.phonemizer) { session.phonemizer.snapshot = hash(next); session.phonemizer.exists = true; }
  return { saved: true, rows };
}
const decoder = new TextDecoder('utf-8', { fatal: true });
const allowed = new Set(['name', 'author', 'voice', 'image', 'version', 'web']);
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function decodeText(raw, asciiAsCp932 = false) {
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) return { encoding: 'UTF-8 BOM', text: decoder.decode(raw.subarray(3)), writable: true };
  if (asciiAsCp932 && raw.every(byte => byte < 0x80)) return { encoding: 'CP932', text: raw.toString('ascii'), writable: true };
  try { return { encoding: 'UTF-8', text: decoder.decode(raw), writable: true }; }
  catch {
    const text = iconv.decode(raw, 'cp932');
    return { encoding: 'CP932', text, writable: iconv.encode(text, 'cp932').equals(raw) };
  }
}

function encodeText(text, encoding) {
  if (encoding === 'UTF-8 BOM') return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
  if (encoding === 'CP932') {
    const result = iconv.encode(text, 'cp932');
    if (iconv.decode(result, 'cp932') !== text) throw new Error('CP932で表現できない文字があります。保存を中止しました');
    return result;
  }
  return Buffer.from(text);
}

function noteToMidi(note) {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!match) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase()];
  const value = (Number(match[3]) + 1) * 12 + base + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  return value >= 0 && value <= 127 ? value : null;
}

function midiToNote(midi) { return `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`; }

function normalizeRelativeVoicebankPath(value) {
  return path.posix.normalize(String(value).replace(/\\/g, '/')).replace(/^(\.\/)+/, '').toLocaleLowerCase();
}

function frqRelativeWavPath(relativeFrqPath) {
  const base = normalizeRelativeVoicebankPath(relativeFrqPath).replace(/\.frq$/i, '');
  if (/\.wav$/i.test(base)) return base;
  if (/_wav$/i.test(base)) return `${base.slice(0, -4)}.wav`;
  return `${base}.wav`;
}

function fieldsFrom(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^=\r\n]*?)\s*=(.*)$/);
    const key = match?.[1].trim();
    if (match && key && !(key in fields)) fields[key] = match[2].trim();
  }
  return fields;
}

function applyChanges(text, changes) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const rows = text.split(/\r?\n/);
  const seen = new Set();
  const updated = rows.map(row => {
    const match = row.match(/^(\s*)([^=\r\n]*?)(\s*)=(.*)$/);
    const key = match?.[2].trim();
    if (!match || !key || !Object.hasOwn(changes, key) || seen.has(key)) return row;
    seen.add(key);
    return `${match[1]}${match[2]}${match[3]}=${changes[key]}`;
  });
  for (const [key, value] of Object.entries(changes)) {
    if (!seen.has(key) && value) updated.splice(updated.at(-1) === '' ? -1 : updated.length, 0, `${key}=${value}`);
  }
  return updated.join(newline);
}

async function scan(root) {
  const counts = { wav: 0, oto: 0, frq: 0, llsm: 0, pmk: 0, folders: 0 };
  const stack = [root];
  while (stack.length) {
    const folder = stack.pop();
    let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name.startsWith('character.txt.backup-')) continue;
      if (entry.isDirectory()) { counts.folders++; stack.push(path.join(folder, entry.name)); }
      else if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name.endsWith('.wav')) counts.wav++;
        if (name === 'oto.ini') counts.oto++;
        if (name.endsWith('.frq')) counts.frq++;
        if (name.endsWith('.llsm')) counts.llsm++;
        if (name.endsWith('.pmk')) counts.pmk++;
      }
    }
  }
  return counts;
}

function displayEncoding(encoding) { return encoding === 'CP932' ? 'ANSI (CP932)' : encoding; }

async function readYamlFile(file) {
  let raw = Buffer.alloc(0);
  let exists = false;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('character.yaml は通常のファイルではありません');
    raw = await fs.readFile(file);
    exists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bom = raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  let source;
  try { source = decoder.decode(bom ? raw.subarray(3) : raw); }
  catch { throw new Error('character.yaml はUTF-8として読み取れません'); }
  const doc = YAML.parseDocument(source, { keepSourceTokens: true });
  return { raw, source, doc, exists, bom };
}

function safeRelativeAsset(root, value) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) return null;
  const candidate = path.resolve(root, value);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

function characterFromYaml(doc) {
  const result = {};
  if (doc.errors.length || (doc.contents && !YAML.isMap(doc.contents))) return result;
  for (const key of allowed) {
    const value = doc.get(key);
    if (typeof value === 'string' || typeof value === 'number') result[key] = String(value);
  }
  return result;
}

async function openVoicebank(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('音源フォルダを指定してください');
  const root = await fs.realpath(path.resolve(input.trim()));
  if (!(await fs.stat(root)).isDirectory()) throw new Error('フォルダを指定してください');
  const characterPath = path.join(root, 'character.txt');
  let raw = Buffer.alloc(0);
  let exists = false;
  try {
    const stat = await fs.lstat(characterPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('character.txt は通常のファイルではありません');
    raw = await fs.readFile(characterPath);
    exists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { encoding, writable, text } = decodeText(raw, true);
  let readmeExists = false;
  try { readmeExists = Boolean(await fs.lstat(path.join(root, 'readme.txt'))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const id = crypto.randomUUID();
  const character = fieldsFrom(text);
  const yamlPath = path.join(root, 'character.yaml');
  let yamlImage = '';
  let portrait = '';
  let portraitSettings = { height: 0, opacity: 0 };
  let yamlInfo = { exists: false, writable: true, character: {}, warnings: [] };
  let yamlSnapshot = hash(Buffer.alloc(0));
  try {
    const yaml = await readYamlFile(yamlPath);
    const warnings = yaml.doc.errors.map(error => error.message);
    if (yaml.doc.contents && !YAML.isMap(yaml.doc.contents)) warnings.push('character.yaml のルートがマップではありません');
    yamlInfo = { exists: yaml.exists, writable: warnings.length === 0, character: characterFromYaml(yaml.doc), warnings };
    yamlSnapshot = hash(yaml.raw);
    if (yamlInfo.writable) {
      yamlImage = typeof yaml.doc.get('image') === 'string' ? yaml.doc.get('image') : '';
      portrait = typeof yaml.doc.get('portrait') === 'string' ? yaml.doc.get('portrait') : '';
      const portraitHeight = yaml.doc.get('portrait_height');
      const portraitOpacity = yaml.doc.get('portrait_opacity');
      portraitSettings = {
        height: Number.isInteger(portraitHeight) && portraitHeight >= 0 ? portraitHeight : 0,
        opacity: typeof portraitOpacity === 'number' && Number.isFinite(portraitOpacity) ? Math.max(0, Math.min(1, portraitOpacity)) : 0
      };
    }
  } catch (error) { yamlInfo = { exists: true, writable: false, character: {}, warnings: [error.message] }; }
  sessions.set(id, { root, characterPath, yamlPath, yamlSnapshot, snapshot: hash(raw), encoding, writable, exists, portraitSettings, assets: { icon: safeRelativeAsset(root, yamlImage || character.image), portrait: safeRelativeAsset(root, portrait) } });
  return { id, root, name: path.basename(root), character, yaml: yamlInfo, rawText: text, encoding: displayEncoding(encoding), writable, exists, readmeExists, counts: await scan(root), assets: { icon: Boolean(yamlImage || character.image), portrait: Boolean(portrait) }, portraitSettings };
}

async function createReadme(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  const target = path.join(session.root, 'readme.txt');
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('readme.txtの保存先が通常のファイルではありません');
    return { created: false };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let raw = Buffer.alloc(0);
  try {
    const stat = await fs.lstat(session.characterPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('character.txtが通常のファイルではありません');
    raw = await fs.readFile(session.characterPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hash(raw) !== session.snapshot) throw new Error('外部でcharacter.txtが変更されました。音源を開き直してください');
  const details = fieldsFrom(decodeText(raw, true).text);
  const output = makeReadme(details.name || path.basename(session.root), details.author || '');
  const temp = path.join(session.root, `.readme.txt.tmp-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(temp, output, { flag: 'wx' });
    await fs.link(temp, target);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('readme.txtが外部で作成されました。音源を開き直してください');
    throw error;
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  return { created: true };
}

async function readReadme(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  const target = path.join(session.root, 'readme.txt');
  let raw = Buffer.alloc(0);
  let exists = false;
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('readme.txtが通常のファイルではありません');
    if (stat.size > 1024 * 1024) throw new Error('readme.txtが大きすぎます');
    raw = await fs.readFile(target);
    exists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const decoded = decodeText(raw, true);
  session.readme = { snapshot: hash(raw), exists, encoding: exists ? decoded.encoding : 'CP932', writable: decoded.writable };
  return { exists, text: decoded.text, encoding: displayEncoding(session.readme.encoding), writable: decoded.writable };
}

async function saveReadme(id, text) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024 || text.includes('\0')) throw new Error('readme.txtの内容を確認してください');
  if (!session.readme) throw new Error('readme.txtを読み直してください');
  if (!session.readme.writable) throw new Error('元の文字列を安全に再現できないため、保存を中止しました');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  const target = path.join(session.root, 'readme.txt');
  let current = Buffer.alloc(0);
  let exists = false;
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('readme.txtが通常のファイルではありません');
    current = await fs.readFile(target);
    exists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (exists !== session.readme.exists || hash(current) !== session.readme.snapshot) throw new Error('外部でreadme.txtが変更されました。音源を開き直してください');
  const oldText = decodeText(current, true).text;
  const newline = oldText.includes('\r\n') ? '\r\n' : '\n';
  const normalized = text.replace(/\r\n|\r|\n/g, newline);
  const next = encodeText(normalized, session.readme.encoding);
  if (next.equals(current)) return { saved: false, message: '変更はありません' };
  const temp = path.join(session.root, `.readme.txt.tmp-${crypto.randomUUID()}`);
  try { await fs.writeFile(temp, next, { flag: 'wx' }); await fs.rename(temp, target); }
  catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  session.readme = { ...session.readme, snapshot: hash(next), exists: true };
  return { saved: true };
}

async function savePortraitSettings(id, settings) {
  const session = sessions.get(id);
  if (!session || !settings || !Number.isInteger(settings.height) || settings.height < 0 || settings.height > 800 || typeof settings.opacity !== 'number' || !Number.isFinite(settings.opacity) || settings.opacity < 0 || settings.opacity > 1) throw new Error('立ち絵の表示設定を確認してください');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  const yaml = await readYamlFile(session.yamlPath);
  if (hash(yaml.raw) !== session.yamlSnapshot) throw new Error('外部でcharacter.yamlが変更されました。音源を開き直してください');
  if (yaml.doc.errors.length || (yaml.doc.contents && !YAML.isMap(yaml.doc.contents))) throw new Error('character.yamlを安全に編集できません');
  yaml.doc.set('portrait_height', settings.height);
  yaml.doc.set('portrait_opacity', settings.opacity);
  const output = yaml.doc.toString({ lineWidth: 0 });
  const updated = yaml.source.includes('\r\n') ? output.replace(/\n/g, '\r\n') : output;
  const next = Buffer.concat([yaml.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(updated)]);
  if (next.equals(yaml.raw)) return { saved: false, message: '変更はありません', settings: session.portraitSettings };
  const temp = path.join(session.root, `.character.yaml.tmp-${crypto.randomUUID()}`);
  try { await fs.writeFile(temp, next, { flag: 'wx' }); await fs.rename(temp, session.yamlPath); }
  catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  session.yamlSnapshot = hash(next);
  session.portraitSettings = { height: settings.height, opacity: settings.opacity };
  if (session.phonemizer) { session.phonemizer.snapshot = hash(next); session.phonemizer.exists = true; }
  return { saved: true, settings: session.portraitSettings };
}

async function readFrequencyFiles(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  const files = [];
  const pending = [session.root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (['.frq', '.llsm', '.pmk'].includes(extension)) files.push({ path: path.relative(session.root, fullPath).split(path.sep).join('/'), extension });
      }
    }
  }
  return files.sort((a, b) => a.extension.localeCompare(b.extension) || a.path.localeCompare(b.path));
}

async function deleteFrequencyFile(id, relativePath) {
  const session = sessions.get(id);
  if (!session || typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) throw new Error('周波数表ファイルを確認してください');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  const candidate = path.resolve(session.root, relativePath);
  const lexicalRelative = path.relative(session.root, candidate);
  if (!lexicalRelative || lexicalRelative.startsWith('..') || path.isAbsolute(lexicalRelative) || !['.frq', '.llsm', '.pmk'].includes(path.extname(candidate).toLowerCase())) throw new Error('音源フォルダ内の周波数表ファイルを選択してください');
  const stat = await fs.lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('通常の周波数表ファイルではありません');
  const realPath = await fs.realpath(candidate);
  const realRelative = path.relative(session.root, realPath);
  if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('音源フォルダ外のファイルは削除できません');
  await fs.unlink(realPath);
  return await readFrequencyFiles(id);
}

async function deleteFrequencyFilesByExtension(id, extension) {
  const session = sessions.get(id);
  const allowed = ['.frq', '.llsm', '.pmk'];
  if (!session || !allowed.includes(extension)) throw new Error('周波数表の拡張子を確認してください');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  const files = (await readFrequencyFiles(id)).filter(file => file.extension === extension);
  for (const file of files) await deleteFrequencyFile(id, file.path);
  return { files: await readFrequencyFiles(id), deleted: files.length };
}

async function readPitchSources(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  const aliasesBySample = new Map();
  const pending = [session.root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) { pending.push(fullPath); continue; }
      if (!entry.isFile() || entry.name.toLowerCase() !== 'oto.ini') continue;
      let text;
      try { text = decodeText(await fs.readFile(fullPath)).text; }
      catch { continue; }
      for (const line of text.split(/\r?\n/)) {
        const equals = line.indexOf('=');
        if (equals < 0) continue;
        const filename = normalizeRelativeVoicebankPath(line.slice(0, equals).trim());
        const alias = line.slice(equals + 1).split(',')[0].trim();
        if (!filename || !alias) continue;
        const directoryKey = normalizeRelativeVoicebankPath(path.relative(session.root, directory));
        const sampleKey = `${directoryKey ? `${directoryKey}/` : ''}${filename}`;
        const list = aliasesBySample.get(sampleKey) || [];
        list.push(alias);
        aliasesBySample.set(sampleKey, list);
      }
    }
  }
  const found = new Map();
  const frqPending = [session.root];
  while (frqPending.length) {
    const directory = frqPending.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) { frqPending.push(fullPath); continue; }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.frq') continue;
      let raw;
      try { raw = await fs.readFile(fullPath); } catch { continue; }
      if (raw.length < 40 || raw.subarray(0, 8).toString('ascii') !== 'FREQ0003') continue;
      const hopSize = raw.readInt32LE(8);
      const averageF0 = raw.readDoubleLE(12);
      const length = raw.readInt32LE(36);
      if (hopSize <= 0 || !Number.isSafeInteger(length) || length < 0 || length > 10_000_000 || raw.length < 40 + length * 16) continue;
      const freqs = [];
      for (let i = 0, offset = 40; i < length; i++, offset += 16) {
        const hz = raw.readDoubleLE(offset);
        if (Number.isFinite(hz) && hz >= 50 && hz <= 1200) freqs.push(hz);
      }
      const sourceHz = Number.isFinite(averageF0) && averageF0 >= 50 && averageF0 <= 1200
        ? averageF0
        : freqs.length ? Math.exp(freqs.reduce((sum, hz) => sum + Math.log(hz), 0) / freqs.length) : 0;
      if (!sourceHz) continue;
      const midi = Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(sourceHz / 440))));
      const note = midiToNote(midi);
      const relativePath = normalizeRelativeVoicebankPath(path.relative(session.root, fullPath));
      const wavPath = frqRelativeWavPath(relativePath);
      const samplePath = wavPath.replace(/\.wav$/i, '');
      const aliases = aliasesBySample.get(wavPath) || aliasesBySample.get(samplePath) || [];
      let aliasesParsed = false;
      for (const alias of aliases) {
        let match = /^(?<note>[A-Ga-g][#b]?-?\d)(?<rest>.*)$/.exec(alias);
        let prefix = '';
        let suffix = '';
        if (match) suffix = match.groups.rest;
        else {
          match = /^(?<rest>.*?)(?<note>[A-Ga-g][#b]?-?\d)$/.exec(alias);
          if (match) prefix = match.groups.rest;
        }
        if (!match) { prefix = alias; suffix = ''; }
        const key = `${midi}\0${prefix}\0${suffix}`;
        found.set(key, { note, prefix, suffix });
        aliasesParsed = true;
      }
      if (!aliasesParsed) found.set(`${midi}\0\0`, { note, prefix: '', suffix: '' });
    }
  }
  return [...found.values()].sort((a, b) => noteToMidi(a.note) - noteToMidi(b.note));
}

async function readFrqFolderPitches(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  const aliasesBySample = new Map();
  const aliasesByFolder = new Map();
  const otoPending = [session.root];
  while (otoPending.length) {
    const directory = otoPending.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) { otoPending.push(fullPath); continue; }
      if (!entry.isFile() || entry.name.toLowerCase() !== 'oto.ini') continue;
      let text;
      try { text = decodeText(await fs.readFile(fullPath)).text; } catch { continue; }
      const relativeDirectory = normalizeRelativeVoicebankPath(path.relative(session.root, directory));
      for (const line of text.split(/\r?\n/)) {
        const equals = line.indexOf('=');
        if (equals < 0) continue;
        const wav = normalizeRelativeVoicebankPath(line.slice(0, equals).trim());
        const alias = line.slice(equals + 1).split(',')[0].trim();
        if (!wav || !alias) continue;
        const sampleKey = `${relativeDirectory ? `${relativeDirectory}/` : ''}${wav}`;
        const list = aliasesBySample.get(sampleKey) || [];
        list.push({ alias, filenameStem: path.posix.basename(wav, path.posix.extname(wav)) });
        aliasesBySample.set(sampleKey, list);
        const folderAliases = aliasesByFolder.get(relativeDirectory) || [];
        folderAliases.push(alias);
        aliasesByFolder.set(relativeDirectory, folderAliases);
      }
    }
  }
  const commonSuffixByFolder = new Map();
  for (const [folder, aliases] of aliasesByFolder) {
    if (aliases.length < 2) continue;
    const characters = aliases.map(alias => Array.from(alias));
    let common = '';
    for (let offset = 1; characters.every(alias => alias.length >= offset && alias.at(-offset) === characters[0].at(-offset)); offset++) common = characters[0].slice(-offset).join('');
    if (common && !/^[A-Za-z]$/.test(common)) commonSuffixByFolder.set(folder, common);
  }
  const pitches = new Map();
  const pending = [session.root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) { pending.push(fullPath); continue; }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.frq') continue;
      const relativeFolder = normalizeRelativeVoicebankPath(path.relative(session.root, directory));
      if (!relativeFolder) continue;
      let raw;
      try { raw = await fs.readFile(fullPath); } catch { continue; }
      if (raw.length < 40 || raw.subarray(0, 8).toString('ascii') !== 'FREQ0003') continue;
      const hopSize = raw.readInt32LE(8);
      const length = raw.readInt32LE(36);
      if (hopSize <= 0 || !Number.isSafeInteger(length) || length < 0 || length > 10_000_000 || raw.length < 40 + length * 16) continue;
      const voiced = [];
      for (let i = 0, offset = 40; i < length; i++, offset += 16) {
        const value = raw.readDoubleLE(offset);
        if (Number.isFinite(value) && value >= 50 && value <= 1200) voiced.push(value);
      }
      voiced.sort((a, b) => a - b);
      const hz = voiced.length ? voiced[Math.floor(voiced.length / 2)] : 0;
      if (!hz) continue;
      const midi = Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(hz / 440))));
      const note = midiToNote(midi);
      const relativeFile = normalizeRelativeVoicebankPath(path.relative(session.root, fullPath));
      const wavPath = frqRelativeWavPath(relativeFile);
      const samplePath = wavPath.replace(/\.wav$/i, '');
      const aliases = aliasesBySample.get(wavPath) || aliasesBySample.get(samplePath) || [];
      for (const { alias, filenameStem } of aliases) {
        let suffix = '';
        if (filenameStem && alias.toLocaleLowerCase().startsWith(filenameStem)) suffix = alias.slice(filenameStem.length);
        if (!suffix) {
          const match = /(?<suffix>[_-]?[A-Ga-g][#b]?-?\d)$/.exec(alias);
          if (match) suffix = match.groups.suffix;
        }
        if (!suffix) suffix = commonSuffixByFolder.get(relativeFolder.toLocaleLowerCase()) || '';
        if (!suffix || /[\r\n\t]/.test(suffix)) continue;
        const key = `${relativeFolder}\0${suffix}`;
        let group = pitches.get(key);
        if (!group) { group = { folder: relativeFolder, suffix, counts: new Map() }; pitches.set(key, group); }
        group.counts.set(midi, (group.counts.get(midi) || 0) + 1);
      }
    }
  }
  const dominantByFolder = new Map();
  for (const group of pitches.values()) {
    const count = [...group.counts.values()].reduce((sum, value) => sum + value, 0);
    const current = dominantByFolder.get(group.folder);
    if (!current || count > current.count || (count === current.count && group.suffix.localeCompare(current.group.suffix) < 0)) {
      dominantByFolder.set(group.folder, { group, count });
    }
  }
  return [...dominantByFolder.values()].map(({ group }) => {
    const midi = [...group.counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    return { folder: group.folder, suffix: group.suffix, midi, note: midiToNote(midi) };
  }).sort((a, b) => a.midi - b.midi || a.folder.localeCompare(b.folder) || a.suffix.localeCompare(b.suffix));
}

async function getAssetPath(id, kind) {
  const session = sessions.get(id);
  if (!session || !['icon', 'portrait', 'icon-txt', 'icon-yaml'].includes(kind)) throw new Error('音源を開き直してください');
  let file = session.assets[kind];
  if (kind === 'icon-txt') {
    let raw = Buffer.alloc(0);
    try {
      const stat = await fs.lstat(session.characterPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('character.txtが通常のファイルではありません');
      raw = await fs.readFile(session.characterPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    file = safeRelativeAsset(session.root, fieldsFrom(decodeText(raw, true).text).image);
  }
  if (kind === 'icon-yaml') {
    const yaml = await readYamlFile(session.yamlPath);
    file = safeRelativeAsset(session.root, characterFromYaml(yaml.doc).image);
  }
  if (!file) return null;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return file;
  } catch { return null; }
}

async function saveYamlValue(session, key, value) {
  const yaml = await readYamlFile(session.yamlPath);
  if (yaml.doc.errors.length || (yaml.doc.contents && !YAML.isMap(yaml.doc.contents))) throw new Error('character.yamlを安全に編集できません');
  yaml.doc.set(key, value);
  const output = yaml.doc.toString({ lineWidth: 0 });
  const updated = yaml.source.includes('\r\n') ? output.replace(/\n/g, '\r\n') : output;
  const next = Buffer.concat([yaml.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(updated)]);
  const temp = path.join(session.root, `.character.yaml.tmp-${crypto.randomUUID()}`);
  try { await fs.writeFile(temp, next, { flag: 'wx' }); await fs.rename(temp, session.yamlPath); }
  catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  if (session.phonemizer) {
    session.phonemizer.snapshot = hash(next);
    session.phonemizer.exists = true;
  }
  session.yamlSnapshot = hash(next);
}

async function saveYamlCharacter(id, changes) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.entries(changes).some(([key, value]) => !allowed.has(key) || typeof value !== 'string' || /[\r\n]/.test(value))) throw new Error('編集内容を確認してください');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  const yaml = await readYamlFile(session.yamlPath);
  if (hash(yaml.raw) !== session.yamlSnapshot) throw new Error('外部でcharacter.yamlが変更されました。音源を開き直してください');
  if (yaml.doc.errors.length || (yaml.doc.contents && !YAML.isMap(yaml.doc.contents))) throw new Error('character.yamlを安全に編集できません');
  for (const [key, value] of Object.entries(changes)) {
    if (value) yaml.doc.set(key, value);
    else yaml.doc.delete(key);
  }
  const output = yaml.doc.toString({ lineWidth: 0 });
  const updated = yaml.source.includes('\r\n') ? output.replace(/\n/g, '\r\n') : output;
  const next = Buffer.concat([yaml.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(updated)]);
  if (next.equals(yaml.raw)) return { saved: false, message: '変更はありません', character: characterFromYaml(yaml.doc) };
  const temp = path.join(session.root, `.character.yaml.tmp-${crypto.randomUUID()}`);
  try { await fs.writeFile(temp, next, { flag: 'wx' }); await fs.rename(temp, session.yamlPath); }
  catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  session.yamlSnapshot = hash(next);
  if (session.phonemizer) { session.phonemizer.snapshot = hash(next); session.phonemizer.exists = true; }
  const character = characterFromYaml(yaml.doc);
  session.assets.icon = safeRelativeAsset(session.root, character.image);
  return { saved: true, character };
}

async function saveAsset(id, kind, sourcePath, iconTarget = 'both', convertedBmp = null) {
  const session = sessions.get(id);
  if (!session || !['icon', 'portrait'].includes(kind)) throw new Error('音源を開き直してください');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  const source = await fs.realpath(sourcePath);
  const stat = await fs.stat(source);
  if (!stat.isFile()) throw new Error('画像ファイルを選択してください');
  const extension = kind === 'icon' && iconTarget === 'txt' ? '.bmp' : path.extname(source).toLowerCase();
  const allowedExtensions = kind === 'icon' ? new Set(['.png', '.jpg', '.jpeg', '.bmp']) : new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);
  if (!allowedExtensions.has(extension)) throw new Error('対応する画像はPNG、JPEG、BMP' + (kind === 'portrait' ? '、WebP' : '') + 'です');
  if (kind === 'icon' && !['txt', 'yaml', 'both'].includes(iconTarget)) throw new Error('アイコンの保存先を確認してください');
  if (kind === 'icon' && iconTarget === 'txt' && (!Buffer.isBuffer(convertedBmp) || convertedBmp.length < 54)) throw new Error('100×100のBMP変換に失敗しました');
  const filename = kind === 'icon' && iconTarget === 'txt' ? 'icon.bmp' : `${kind === 'icon' ? 'icon' : 'portrait'}${extension === '.jpeg' ? '.jpg' : extension}`;
  const destination = path.join(session.root, filename);
  if (source !== destination) {
    try {
      const current = await fs.lstat(destination);
      if (!current.isFile() || current.isSymbolicLink()) throw new Error('保存先が通常のファイルではありません');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temp = path.join(session.root, `.${filename}.tmp-${crypto.randomUUID()}`);
    try { if (kind === 'icon' && iconTarget === 'txt') await fs.writeFile(temp, convertedBmp, { flag: 'wx' }); else await fs.copyFile(source, temp); await fs.rename(temp, destination); }
    catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  }
  if (kind === 'icon') {
    let character;
    if (iconTarget === 'txt' || iconTarget === 'both') {
      const result = await saveCharacter(id, { image: filename });
      character = result.character;
    }
    if (iconTarget === 'yaml' || iconTarget === 'both') await saveYamlValue(session, 'image', filename);
    session.assets.icon = destination;
    return { saved: true, filename, character };
  }
  await saveYamlValue(session, 'portrait', filename);
  session.assets.portrait = destination;
  return { saved: true, filename };
}

async function saveCharacter(id, changes) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  if (!session.writable) throw new Error('元のCP932バイト列を安全に再現できないため、保存を中止しました');
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.entries(changes).some(([key, value]) => !allowed.has(key) || typeof value !== 'string' || /[\r\n]/.test(value))) throw new Error('編集内容を確認してください');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  let current = Buffer.alloc(0);
  try {
    const stat = await fs.lstat(session.characterPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('character.txt は通常のファイルではありません');
    current = await fs.readFile(session.characterPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hash(current) !== session.snapshot) throw new Error('外部で character.txt が変更されました。音源を開き直してください');
  const source = decodeText(current).text;
  const updated = applyChanges(source, changes);
  const next = encodeText(updated, session.encoding);
  if (next.equals(current)) return { saved: false, message: '変更はありません' };
  const temp = path.join(session.root, `.character.txt.tmp-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(temp, next, { flag: 'wx' });
    await fs.rename(temp, session.characterPath);
  } catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  session.snapshot = hash(next);
  session.exists = true;
  if (Object.hasOwn(changes, 'image')) session.assets.icon = safeRelativeAsset(session.root, changes.image);
  return { saved: true, character: fieldsFrom(updated), rawText: updated };
}

function parsePrefixMap(text) {
  const entries = [];
  const warnings = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells = line.split('\t');
    const midi = noteToMidi(cells[0]);
    if (cells.length !== 3 || midi === null) { warnings.push(`形式を確認: ${line.slice(0, 60)}`); continue; }
    if (seen.has(midi)) warnings.push(`重複: ${cells[0]}`);
    else { seen.add(midi); entries.push({ note: midiToNote(midi), prefix: cells[1], suffix: cells[2] }); }
  }
  entries.sort((a, b) => noteToMidi(a.note) - noteToMidi(b.note));
  return { entries, warnings };
}

async function readPrefixMap(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  const file = path.join(session.root, 'prefix.map');
  let raw = Buffer.alloc(0);
  let exists = false;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('prefix.map は通常のファイルではありません');
    raw = await fs.readFile(file);
    exists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const decoded = decodeText(raw);
  const parsed = parsePrefixMap(decoded.text);
  session.prefixMap = { file, snapshot: hash(raw), encoding: exists ? decoded.encoding : session.encoding, writable: decoded.writable, exists };
  return { exists, encoding: displayEncoding(session.prefixMap.encoding), writable: decoded.writable, ...parsed };
}

async function savePrefixMap(id, entries) {
  const session = sessions.get(id);
  if (!session?.prefixMap) throw new Error('音階マップを読み込み直してください');
  const record = session.prefixMap;
  if (!record.writable) throw new Error('元のprefix.mapを安全に再現できないため保存を中止しました');
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  if (!Array.isArray(entries) || entries.length > 128) throw new Error('音階の数を確認してください');
  const requested = new Map();
  for (const entry of entries) {
    const midi = typeof entry?.note === 'string' ? noteToMidi(entry.note) : null;
    if (midi === null || requested.has(midi) || typeof entry.prefix !== 'string' || typeof entry.suffix !== 'string' || /[\r\n\t]/.test(entry.prefix + entry.suffix)) throw new Error('音階の割り当てを確認してください');
    requested.set(midi, { prefix: entry.prefix, suffix: entry.suffix });
  }
  let current = Buffer.alloc(0);
  try {
    const stat = await fs.lstat(record.file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('prefix.map は通常のファイルではありません');
    current = await fs.readFile(record.file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hash(current) !== record.snapshot) throw new Error('外部でprefix.mapが変更されました。読み込み直してください');
  const source = decodeText(current).text;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const seen = new Set();
  const lines = source.split(/\r?\n/).map(line => {
    const cells = line.split('\t');
    const midi = noteToMidi(cells[0]);
    if (midi === null || !requested.has(midi) || seen.has(midi) || cells.length !== 3) return line;
    seen.add(midi);
    const value = requested.get(midi);
    return `${cells[0]}\t${value.prefix}\t${value.suffix}`;
  });
  for (const [midi, value] of [...requested].sort((a, b) => a[0] - b[0])) {
    if (!seen.has(midi)) lines.splice(lines.at(-1) === '' ? -1 : lines.length, 0, `${midiToNote(midi)}\t${value.prefix}\t${value.suffix}`);
  }
  const updated = lines.join(newline);
  const next = encodeText(updated, record.encoding);
  if (next.equals(current)) return { saved: false, message: '変更はありません' };
  const temp = path.join(session.root, `.prefix.map.tmp-${crypto.randomUUID()}`);
  try { await fs.writeFile(temp, next, { flag: 'wx' }); await fs.rename(temp, record.file); }
  catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  record.snapshot = hash(next);
  record.exists = true;
  return { saved: true, entries: parsePrefixMap(updated).entries };
}

async function readPhonemizer(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('音源を開き直してください');
  const file = path.join(session.root, 'character.yaml');
  let raw = Buffer.alloc(0);
  let exists = false;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('character.yaml は通常のファイルではありません');
    raw = await fs.readFile(file);
    exists = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let source;
  try { source = decoder.decode(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? raw.subarray(3) : raw); }
  catch { throw new Error('character.yaml はUTF-8として読み取れません'); }
  const doc = YAML.parseDocument(source, { keepSourceTokens: true });
  const warnings = doc.errors.map(error => error.message);
  if (doc.contents && !YAML.isMap(doc.contents)) warnings.push('character.yaml のルートがマップではありません');
  const value = !doc.contents || YAML.isMap(doc.contents) ? doc.get('default_phonemizer') : undefined;
  const singerType = !doc.contents || YAML.isMap(doc.contents) ? doc.get('singer_type') : undefined;
  if (value != null && typeof value !== 'string') warnings.push('default_phonemizer が文字列ではありません');
  const writable = warnings.length === 0;
  session.phonemizer = { file, snapshot: hash(raw), exists, bom: raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), writable };
  return { exists, value: typeof value === 'string' ? value : '', writable, warnings };
}

async function savePhonemizer(id, value) {
  const session = sessions.get(id);
  if (!session?.phonemizer) throw new Error('character.yaml を読み込み直してください');
  if (!session.phonemizer.writable) throw new Error('character.yaml を安全に編集できません');
  if (typeof value !== 'string' || /[\r\n\t]/.test(value)) throw new Error('Phonemizerの識別子を確認してください');
  const input = value.trim();
  const record = session.phonemizer;
  if (await fs.realpath(session.root) !== session.root) throw new Error('音源フォルダが変更されました');
  let current = Buffer.alloc(0);
  try {
    const stat = await fs.lstat(record.file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('character.yaml は通常のファイルではありません');
    current = await fs.readFile(record.file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hash(current) !== record.snapshot) throw new Error('外部でcharacter.yamlが変更されました。読み込み直してください');
  const source = decoder.decode(record.bom ? current.subarray(3) : current);
  const doc = YAML.parseDocument(source, { keepSourceTokens: true });
  if (doc.errors.length) throw new Error('character.yaml の構文エラーを修正してください');
  if (doc.contents && !YAML.isMap(doc.contents)) throw new Error('character.yaml のルートはマップ形式が必要です');
  const oldValue = doc.get('default_phonemizer');
  if ((typeof oldValue === 'string' ? oldValue : '') === input) return { saved: false, message: '変更はありません' };
  if (input) doc.set('default_phonemizer', input);
  else doc.delete('default_phonemizer');
  const output = doc.toString({ lineWidth: 0 });
  const updated = source.includes('\r\n') ? output.replace(/\n/g, '\r\n') : output;
  const next = Buffer.concat([record.bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(updated)]);
  const temp = path.join(session.root, `.character.yaml.tmp-${crypto.randomUUID()}`);
  try { await fs.writeFile(temp, next, { flag: 'wx' }); await fs.rename(temp, record.file); }
  catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
  record.snapshot = hash(next);
  record.exists = true;
  session.yamlSnapshot = hash(next);
  return { saved: true, value: input };
}

module.exports = { openVoicebank, getVoicebankRoot, createReadme, readReadme, saveReadme, listVoicebankFiles, findReadFiles, deleteReadFiles, readVoiceColors, saveVoiceColors, saveCharacter, saveYamlCharacter, readPrefixMap, savePrefixMap, readPhonemizer, savePhonemizer, readPitchSources, readFrqFolderPitches, readFrequencyFiles, deleteFrequencyFile, deleteFrequencyFilesByExtension, savePortraitSettings, getAssetPath, saveAsset };
