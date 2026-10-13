const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');

const ID = /^[a-z][a-z0-9._-]{2,63}$/;
const COMMAND = /^[a-z][a-z0-9_-]{0,39}$/;
const PERMISSIONS = new Set(['voicebank:read', 'voicebank:write']);
const TEXT_EXTENSIONS = new Set(['.txt', '.ini', '.yaml', '.yml', '.json', '.csv', '.tsv', '.map']);
const MAX_TEXT = 1024 * 1024;
const PLUGIN_API_VERSION = 1;

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.apiVersion !== PLUGIN_API_VERSION || !ID.test(value.id)) throw new Error('plugin.jsonのIDまたはAPIバージョンが無効です');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80 || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)) throw new Error('プラグインの名前またはバージョンを確認してください');
  if (value.author !== undefined && (typeof value.author !== 'string' || value.author.length > 80 || /[\x00-\x1f\x7f]/.test(value.author))) throw new Error('製作者名義は80文字以内の1行で指定してください');
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 240)) throw new Error('説明文が長すぎます');
  if (!Array.isArray(value.permissions) || value.permissions.some(permission => !PERMISSIONS.has(permission)) || new Set(value.permissions).size !== value.permissions.length) throw new Error('プラグインの権限を確認してください');
  if (value.permissions.includes('voicebank:write') && !value.permissions.includes('voicebank:read')) throw new Error('書き込みには読み取り権限も必要です');
  if (!Array.isArray(value.commands) || !value.commands.length || value.commands.length > 12 || value.commands.some(command => !command || !COMMAND.test(command.id) || typeof command.title !== 'string' || !command.title.trim() || command.title.length > 60) || new Set(value.commands.map(command => command.id)).size !== value.commands.length) throw new Error('コマンドの定義を確認してください');
  return {
    apiVersion: PLUGIN_API_VERSION, id: value.id, name: value.name.trim(), author: value.author?.trim() || '', version: value.version,
    description: value.description || '', permissions: value.permissions,
    commands: value.commands.map(command => ({ id: command.id, title: command.title.trim() }))
  };
}

async function readRegular(file, limit) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('プラグインファイルの形式またはサイズを確認してください');
  return fs.readFile(file);
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function createPluginManager(directory, bundledDirectory, showMessage, getVoicebankRoot) {
  const runs = new Map();
  const builtinId = 'builtin.release-checker';

  async function load(folder) {
    const manifest = validateManifest(JSON.parse(decodeUtf8(await readRegular(path.join(folder, 'plugin.json'), 16 * 1024)).replace(/^\uFEFF/, '')));
    const source = decodeUtf8(await readRegular(path.join(folder, 'main.js'), 128 * 1024));
    if (source.includes('\0')) throw new Error('main.jsに無効な文字があります');
    return { manifest, source };
  }

  async function installed(id) {
    if (!ID.test(id)) throw new Error('プラグインIDが無効です');
    if (id === builtinId) {
      const plugin = await load(path.join(bundledDirectory, 'release-checker'));
      if (plugin.manifest.id !== builtinId) throw new Error('標準プラグインのIDが一致しません');
      return { ...plugin, manifest: { ...plugin.manifest, builtIn: true } };
    }
    const folder = path.join(directory, id);
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('プラグインフォルダを確認してください');
    const plugin = await load(folder);
    if (plugin.manifest.id !== id) throw new Error('プラグインIDが一致しません');
    return plugin;
  }

  async function list() {
    await fs.mkdir(directory, { recursive: true });
    const result = [(await installed(builtinId)).manifest];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !ID.test(entry.name) || entry.name === builtinId) continue;
      try { result.push((await installed(entry.name)).manifest); }
      catch { /* 壊れたプラグインは実行しない */ }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  async function install(folder) {
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('プラグインフォルダを選択してください');
    const { manifest, source } = await load(folder);
    if (manifest.id === builtinId) throw new Error('標準プラグインのIDは使用できません');
    const target = path.join(directory, manifest.id);
    await fs.mkdir(directory, { recursive: true });
    if (await fs.lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))) throw new Error('同じIDのプラグインが既にあります。削除してから導入してください');
    const permissionText = manifest.permissions.includes('voicebank:write') ? '音源内のテキストファイルの読み書き' : manifest.permissions.includes('voicebank:read') ? '音源内のテキストファイルの読み取り' : '音源名の取得のみ';
    const answer = await showMessage({ type: 'question', title: 'プラグインを追加', message: `${manifest.name} を追加しますか？`, detail: `ID: ${manifest.id}\n製作者名義: ${manifest.author || '未設定'}\nバージョン: ${manifest.version}\n権限: ${permissionText}\n作成者のコードを実行します。信頼できるプラグインだけ追加してください。`, buttons: ['キャンセル', '追加'], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return false;
    const temp = path.join(directory, `.install-${crypto.randomUUID()}`);
    await fs.mkdir(temp);
    try {
      await fs.writeFile(path.join(temp, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
      await fs.writeFile(path.join(temp, 'main.js'), source, { flag: 'wx' });
      await fs.rename(temp, target);
    } catch (error) { await fs.rm(temp, { recursive: true, force: true }); throw error; }
    return true;
  }

  async function remove(id) {
    if (id === builtinId) throw new Error('標準プラグインは削除できません');
    const { manifest } = await installed(id);
    const answer = await showMessage({ type: 'warning', title: 'プラグインを削除', message: `${manifest.name} を削除しますか？`, buttons: ['キャンセル', '削除'], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return false;
    for (const [runId, run] of runs) if (run.pluginId === id) runs.delete(runId);
    await fs.rm(path.join(directory, id), { recursive: true });
    return true;
  }

  async function begin(id, commandId, voicebankId) {
    const { manifest, source } = await installed(id);
    if (!manifest.commands.some(command => command.id === commandId)) throw new Error('コマンドを確認してください');
    const root = getVoicebankRoot(voicebankId);
    if (!root || await fs.realpath(root) !== root) throw new Error('音源を開き直してください');
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('音源フォルダを確認してください');
    if (manifest.permissions.includes('voicebank:write')) {
      const answer = await showMessage({ type: 'warning', title: 'プラグインの書き込み', message: `${manifest.name} に音源内のテキストファイルへの書き込みを許可しますか？`, detail: 'この実行中だけ有効です。変更前にファイルの状態を確認します。', buttons: ['キャンセル', '実行'], defaultId: 0, cancelId: 0, noLink: true });
      if (answer.response !== 1) return null;
    }
    const runId = crypto.randomUUID();
    runs.set(runId, { pluginId: id, root, permissions: new Set(manifest.permissions), snapshots: new Map(), expires: Date.now() + 30000, wrote: false });
    return { runId, source, voicebank: { name: path.basename(root) } };
  }

  function end(runId) { const run = runs.get(runId); runs.delete(runId); return { wrote: Boolean(run?.wrote) }; }

  async function targetFor(run, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.length > 500 || relativePath.includes('\0') || relativePath.includes('\\') || relativePath.includes(':')) throw new Error('相対パスを指定してください');
    const parts = relativePath.split('/');
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..') || path.posix.isAbsolute(relativePath)) throw new Error('音源内の相対パスを指定してください');
    const target = path.resolve(run.root, ...parts);
    const relative = path.relative(run.root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !TEXT_EXTENSIONS.has(path.extname(target).toLowerCase())) throw new Error('対象は音源内のテキストファイルに限ります');
    if (await fs.realpath(run.root) !== run.root) throw new Error('音源フォルダが変更されました');
    let parent = run.root;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      const stat = await fs.lstat(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('リンク先や存在しないフォルダは使えません');
    }
    if (await fs.realpath(parent) !== parent) throw new Error('リンク先は使えません');
    const stat = await fs.lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('通常ファイル以外は使えません');
    if (stat && await fs.realpath(target) !== target) throw new Error('リンク先は使えません');
    return { target, stat };
  }

  async function call(runId, method, args) {
    const run = runs.get(runId);
    if (!run || Date.now() > run.expires) throw new Error('プラグインの実行期限が切れました');
    if (!Array.isArray(args) || args.length > 2) throw new Error('引数を確認してください');
    if (method === 'listFiles') {
      if (!run.permissions.has('voicebank:read')) throw new Error('読み取り権限がありません');
      if (args.length) throw new Error('listFilesに引数は指定できません');
      if (await fs.realpath(run.root) !== run.root) throw new Error('音源フォルダが変更されました');
      const files = [];
      const pending = [{ directory: run.root, relative: '' }];
      while (pending.length) {
        const current = pending.pop();
        const directoryStat = await fs.lstat(current.directory);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || await fs.realpath(current.directory) !== current.directory) throw new Error('音源フォルダの構成が変更されました');
        for (const entry of await fs.readdir(current.directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) continue;
          const full = path.join(current.directory, entry.name);
          const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) pending.push({ directory: full, relative });
          else if (entry.isFile()) files.push(relative);
          if (files.length + pending.length > 10000) throw new Error('ファイル数が上限を超えています');
        }
      }
      return files.sort((a, b) => a.localeCompare(b, 'ja'));
    }
    if (method === 'readText') {
      if (!run.permissions.has('voicebank:read')) throw new Error('読み取り権限がありません');
      const encoding = args[1] === undefined ? 'utf8' : args[1];
      if (!['utf8', 'cp932', 'auto'].includes(encoding)) throw new Error('文字コードを確認してください');
      const { target, stat } = await targetFor(run, args[0]);
      if (!stat) { run.snapshots.set(target, null); return null; }
      if (stat.size > MAX_TEXT) throw new Error('1MBを超えるファイルは読み込めません');
      const bytes = await fs.readFile(target);
      if (bytes.length > MAX_TEXT) throw new Error('1MBを超えるファイルは読み込めません');
      let value;
      let writable = false;
      if (encoding === 'cp932') value = iconv.decode(bytes, 'cp932');
      else {
        try { value = decodeUtf8(bytes); writable = true; }
        catch (error) {
          if (encoding !== 'auto') throw error;
          value = iconv.decode(bytes, 'cp932');
        }
      }
      run.snapshots.set(target, writable ? crypto.createHash('sha256').update(bytes).digest('hex') : 'non-utf8');
      return value;
    }
    if (method === 'writeText') {
      if (!run.permissions.has('voicebank:write')) throw new Error('書き込み権限がありません');
      if (typeof args[1] !== 'string' || Buffer.byteLength(args[1], 'utf8') > MAX_TEXT) throw new Error('書き込みは1MB以下のテキストに限ります');
      const { target, stat } = await targetFor(run, args[0]);
      const expected = run.snapshots.get(target);
      if (stat && expected === undefined) throw new Error('既存ファイルは先にreadTextで読み込んでください');
      if (stat && expected === 'non-utf8') throw new Error('UTF-8以外の既存ファイルはプラグインから保存できません');
      if (stat) {
        const current = await fs.readFile(target);
        if (crypto.createHash('sha256').update(current).digest('hex') !== expected) throw new Error('ファイルが外部で変更されました');
      } else if (expected !== undefined && expected !== null) throw new Error('ファイルが外部で変更されました');
      const next = Buffer.from(args[1], 'utf8');
      const temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${crypto.randomUUID()}`);
      try { await fs.writeFile(temp, next, { flag: 'wx' }); await fs.rename(temp, target); }
      catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
      run.snapshots.set(target, crypto.createHash('sha256').update(next).digest('hex'));
      run.wrote = true;
      return true;
    }
    throw new Error('未対応のプラグインAPIです');
  }

  return { list, install, remove, begin, end, call };
}

module.exports = { createPluginManager, PLUGIN_API_VERSION };
