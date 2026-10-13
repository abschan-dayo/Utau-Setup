const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { listWavs } = require('./frq.cjs');

const activeRoots = new Set();
const MAX_WAV_BYTES = 256 * 1024 * 1024;

async function runMoresampler(executable, input, output) {
  const args = [input, output, 'C4', '100', '', '0', '1000', '0', '0', '100', '0', '!120', 'AA'];
  const command = process.platform === 'win32' ? executable : 'wine';
  const commandArgs = process.platform === 'win32' ? args : [executable, ...args];
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: path.dirname(executable), windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume();
    child.stderr.resume();
    const timer = setTimeout(() => child.kill(), 120000);
    child.once('error', error => { clearTimeout(timer); reject(new Error(error.code === 'ENOENT' && process.platform !== 'win32' ? 'Wineを起動できません。Wineの導入を確認してください' : 'Moresamplerを起動できません')); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(signal ? 'Moresamplerの処理がタイムアウトしました' : `Moresamplerが終了コード ${code} で停止しました`));
    });
  });
}

async function generateLlsms(root, executable, overwrite, progress) {
  if (await fs.realpath(root) !== root) throw new Error('音源フォルダが変更されました');
  const executableStat = await fs.lstat(executable);
  if (!executableStat.isFile() || executableStat.isSymbolicLink() || !/\.exe$/i.test(executable)) throw new Error('Moresamplerの実行ファイルを選択してください');
  if (activeRoots.has(root)) throw new Error('LLSMを生成中です');
  activeRoots.add(root);
  try { return await generateLlsmsLocked(root, executable, overwrite, progress); }
  finally { activeRoots.delete(root); }
}

async function generateLlsmsLocked(root, executable, overwrite, progress) {
  const wavs = await listWavs(root);
  const result = { generated: 0, skipped: 0, failed: 0, errors: [] };
  let nextIndex = 0;
  let completed = 0;
  async function processWav(wav) {
    const target = `${wav}.llsm`;
    let temporary = null;
    try {
      let existing = null;
      try { existing = await fs.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('LLSMの保存先が通常のファイルではありません');
      if (existing && !overwrite) { result.skipped++; return; }
      const parent = await fs.realpath(path.dirname(wav));
      const relativeParent = path.relative(root, parent);
      if (relativeParent.startsWith('..') || path.isAbsolute(relativeParent) || await fs.realpath(wav) !== wav) throw new Error('音源フォルダ外またはリンク先のWAVは処理できません');
      const wavStat = await fs.lstat(wav);
      if (!wavStat.isFile() || wavStat.isSymbolicLink() || wavStat.size > MAX_WAV_BYTES) throw new Error('WAVが大きすぎるか通常のファイルではありません');
      temporary = path.join(root, `.utau-setup-llsm-${crypto.randomUUID()}`);
      const analysisFolder = path.join(temporary, path.basename(parent));
      await fs.mkdir(analysisFolder, { recursive: true });
      const analysisWav = path.join(analysisFolder, path.basename(wav));
      await fs.copyFile(wav, analysisWav, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      const analysisOutput = path.join(temporary, 'render.wav');
      await runMoresampler(executable, analysisWav, analysisOutput);
      const generatedFile = `${analysisWav}.llsm`;
      let generatedStat;
      try { generatedStat = await fs.lstat(generatedFile); }
      catch (error) { if (error.code === 'ENOENT') throw new Error('MoresamplerがLLSMを生成しませんでした'); throw error; }
      if (!generatedStat.isFile() || generatedStat.isSymbolicLink() || generatedStat.size < 40) throw new Error('有効なLLSMが生成されませんでした');
      const handle = await fs.open(generatedFile, 'r');
      let header;
      try { header = Buffer.alloc(6); await handle.read(header, 0, 6, 0); }
      finally { await handle.close(); }
      if (!header.equals(Buffer.from([4, 100, 97, 116, 97, 1]))) throw new Error('Moresampler形式のLLSMではありません');
      if (await fs.realpath(root) !== root || await fs.realpath(path.dirname(wav)) !== parent) throw new Error('処理中に音源フォルダが変更されました');
      const currentWav = await fs.lstat(wav);
      if (currentWav.size !== wavStat.size || currentWav.mtimeMs !== wavStat.mtimeMs) throw new Error('処理中にWAVが変更されました');
      let currentTarget = null;
      try { currentTarget = await fs.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (Boolean(currentTarget) !== Boolean(existing) || (existing && (currentTarget.size !== existing.size || currentTarget.mtimeMs !== existing.mtimeMs || currentTarget.isSymbolicLink()))) throw new Error('処理中にLLSMが変更されました');
      await fs.rename(generatedFile, target);
      result.generated++;
    } catch (error) {
      result.failed++;
      if (result.errors.length < 8) result.errors.push(`${path.relative(root, wav)}: ${error.code ? `ファイル操作に失敗しました (${error.code})` : error.message}`);
    } finally {
      if (temporary) {
        const relative = path.relative(root, temporary);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && (await fs.realpath(temporary).catch(() => null)) === temporary) {
          await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
        }
      }
      completed++;
      progress?.({ current: completed, total: wavs.length, generated: result.generated, failed: result.failed });
    }
  }
  const workerCount = Math.min(2, Math.max(1, os.availableParallelism()), wavs.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < wavs.length) {
      const wav = wavs[nextIndex++];
      await processWav(wav);
    }
  }));
  return { ...result, total: wavs.length };
}

module.exports = { generateLlsms };
