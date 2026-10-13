const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');
const { makeReadme } = require('./readme.cjs');

const AUDIO = new Set(['.wav', '.frq', '.llsm', '.pmk']);
const META = new Set(['oto.ini', 'character.txt', 'character.yaml', 'prefix.map', 'readme.txt']);
const MAX_FILES = 30000;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function characterAsCp932(raw) {
  let text;
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) text = utf8Decoder.decode(raw.subarray(3));
  else {
    try { text = utf8Decoder.decode(raw); }
    catch {
      text = iconv.decode(raw, 'cp932');
      if (!iconv.encode(text, 'cp932').equals(raw)) throw new Error('character.txtの文字コードを読み取れません');
    }
  }
  const encoded = iconv.encode(text, 'cp932');
  if (iconv.decode(encoded, 'cp932') !== text) throw new Error('character.txtにANSI (CP932)で表現できない文字があります');
  return encoded;
}

function safeName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value === '.' || value === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value)) throw new Error('音源名に使用できない文字があります');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) throw new Error('この音源名はWindowsで使用できません');
  return value;
}

function pitchTag(name) {
  const match = /(?:^|[_\s-])([A-G](?:#|b)?[1-7])(?=[_\s.-]|$)/i.exec(name);
  return match?.[1]?.toUpperCase() || null;
}

async function analyzeSources(inputs) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 10000) throw new Error('録音ファイルをドロップしてください');
  const files = [];
  const seen = new Set();
  async function walk(file, relative, depth) {
    if (depth > 12 || files.length > MAX_FILES) throw new Error('取り込むファイルが多すぎるか、階層が深すぎます');
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('シンボリックリンクは取り込めません');
    if (stat.isDirectory()) {
      for (const entry of await fs.readdir(file, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('シンボリックリンクは取り込めません');
        await walk(path.join(file, entry.name), path.join(relative, entry.name), depth + 1);
      }
    } else if (stat.isFile()) {
      const base = path.basename(file);
      if (!AUDIO.has(path.extname(base).toLowerCase()) && !META.has(base.toLowerCase())) return;
      const resolved = await fs.realpath(file);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      files.push({ source: resolved, relative, size: stat.size });
    }
  }
  for (const input of inputs) {
    if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('ドロップしたファイルを読み取れません');
    if ((await fs.lstat(input)).isSymbolicLink()) throw new Error('シンボリックリンクは取り込めません');
    const resolved = await fs.realpath(input);
    const stat = await fs.lstat(resolved);
    if (stat.isSymbolicLink()) throw new Error('シンボリックリンクは取り込めません');
    // 単一の親フォルダは音源ルートとして扱う。複数の収録フォルダを
    // まとめてドロップした場合は各フォルダ名を残し、同名のWAVを区別する。
    const relative = stat.isDirectory() && inputs.length === 1 ? '' : path.basename(resolved);
    await walk(resolved, relative, 0);
  }
  const wavs = files.filter(file => path.extname(file.relative).toLowerCase() === '.wav');
  if (!wavs.length) throw new Error('WAVファイルがありません');
  const folders = new Set(wavs.map(file => path.dirname(file.relative)).filter(value => value !== '.'));
  const tags = new Set(wavs.map(file => pitchTag(path.basename(file.relative))).filter(Boolean));
  const multi = folders.size > 1 || tags.size > 1;
  const reason = folders.size > 1 ? '録音フォルダの分かれ方' : tags.size > 1 ? 'ファイル名の音高表記' : '音高の区別を検出できませんでした';
  const character = files.find(file => path.basename(file.relative).toLowerCase() === 'character.txt' && path.dirname(file.relative) === '.');
  const readme = files.find(file => path.basename(file.relative).toLowerCase() === 'readme.txt' && path.dirname(file.relative) === '.');
  return { files, multi, reason, wavCount: wavs.length, folders: [...folders], hasCharacter: Boolean(character), hasReadme: Boolean(readme), totalBytes: files.reduce((sum, file) => sum + file.size, 0) };
}

function outputPath(file, multi, hasFolders, flatSingle) {
  const base = path.basename(file.relative);
  const isOto = base.toLowerCase() === 'oto.ini';
  if (!multi && (AUDIO.has(path.extname(base).toLowerCase()) || isOto)) {
    const inside = flatSingle ? base : file.relative;
    return path.join('原音', isOto ? path.join(path.dirname(inside), 'oto.ini') : inside);
  }
  if (isOto) return path.join(path.dirname(file.relative), 'oto.ini');
  if (META.has(base.toLowerCase()) && path.dirname(file.relative) === '.') return base.toLowerCase();
  if (!multi) return file.relative;
  if (hasFolders || path.dirname(file.relative) !== '.') return file.relative;
  return path.join(pitchTag(base) || '未分類', base);
}

async function createVoicebank(plan, parent, name, multi) {
  safeName(name);
  if (typeof multi !== 'boolean') throw new Error('音階構成を選択してください');
  const parentReal = await fs.realpath(parent);
  if (!(await fs.stat(parentReal)).isDirectory()) throw new Error('保存先フォルダを選択してください');
  const target = path.join(parentReal, name);
  try { await fs.lstat(target); throw new Error('同名の音源フォルダが既にあります'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const file of plan.files) {
    const stat = await fs.lstat(file.source);
    if (!stat.isFile() || stat.size !== file.size) throw new Error('録音ファイルが変更されました。再度ドロップしてください');
  }
  const staging = path.join(parentReal, `.utau-setup-${crypto.randomUUID()}`);
  await fs.mkdir(staging);
  try {
    const destinations = new Set();
    const hasFolders = plan.folders.length > 0;
    const wavFolders = new Set(plan.files.filter(file => path.extname(file.relative).toLowerCase() === '.wav').map(file => path.dirname(file.relative)));
    const flatSingle = wavFolders.size === 1;
    for (const file of plan.files) {
      const relative = outputPath(file, multi, hasFolders, flatSingle);
      const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
      if (destinations.has(key)) throw new Error('同名の録音ファイルがあります。フォルダ構成を確認してください');
      destinations.add(key);
      const dest = path.resolve(staging, relative);
      if (!dest.startsWith(staging + path.sep)) throw new Error('不正なファイル名です');
      await fs.mkdir(path.dirname(dest), { recursive: true });
      if (relative === 'character.txt') await fs.writeFile(dest, characterAsCp932(await fs.readFile(file.source)), { flag: 'wx' });
      else await fs.copyFile(file.source, dest, fs.constants.COPYFILE_EXCL);
    }
    if (!destinations.has('character.txt')) {
      const characterText = `name=${name}\r\n`;
      const encoded = iconv.encode(characterText, 'cp932');
      if (iconv.decode(encoded, 'cp932') !== characterText) throw new Error('音源名をANSI (CP932)で表現できません');
      await fs.writeFile(path.join(staging, 'character.txt'), encoded, { flag: 'wx' });
    }
    if (!destinations.has('readme.txt')) await fs.writeFile(path.join(staging, 'readme.txt'), makeReadme(name), { flag: 'wx' });
    if (!destinations.has('oto.ini')) await fs.writeFile(path.join(staging, 'oto.ini'), Buffer.alloc(0), { flag: 'wx' });
    await fs.rename(staging, target);
    return { path: target, wavCount: plan.wavCount, multi };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { analyzeSources, createVoicebank };
