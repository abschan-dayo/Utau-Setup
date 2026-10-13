const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const HOP = 256;
const MAX_WAV_BYTES = 256 * 1024 * 1024;
const activeRoots = new Set();

async function listWavs(root) {
  const wavs = [];
  const pending = [root];
  let visited = 0;
  while (pending.length) {
    const directory = pending.pop();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      if (++visited > 100000) throw new Error('ファイル数が多すぎるため処理を中止しました');
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(filename);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.wav') wavs.push(filename);
    }
  }
  return wavs.sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
}

function decodeWav(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('RIFF/WAVE形式ではありません');
  let format;
  let data;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > bytes.length) throw new Error('WAVチャンクが破損しています');
    if (name === 'fmt ') {
      if (length < 16) throw new Error('WAVの形式情報が不正です');
      format = { code: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), rate: bytes.readUInt32LE(start + 4), block: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
      if (format.code === 0xfffe && length >= 40) format.code = bytes.readUInt16LE(start + 24);
    }
    if (name === 'data' && !data) data = { start, length };
    offset = start + length + (length & 1);
  }
  if (!format || !data) throw new Error('WAVの音声データがありません');
  const { code, channels, rate, block, bits } = format;
  if (![1, 3].includes(code) || ![8, 16, 24, 32].includes(bits) || (code === 3 && bits !== 32) || channels < 1 || channels > 8 || rate < 8000 || rate > 192000 || block !== channels * bits / 8) throw new Error('対応していないWAV形式です');
  const count = Math.floor(data.length / block);
  if (count < rate / 100) throw new Error('WAVが短すぎます');
  const samples = new Float32Array(count);
  const width = bits / 8;
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) {
      const at = data.start + i * block + ch * width;
      let value;
      if (code === 3) value = bytes.readFloatLE(at);
      else if (bits === 8) value = (bytes[at] - 128) / 128;
      else if (bits === 16) value = bytes.readInt16LE(at) / 32768;
      else if (bits === 24) { const raw = bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16; value = ((raw << 8) >> 8) / 8388608; }
      else value = bytes.readInt32LE(at) / 2147483648;
      sum += Number.isFinite(value) ? value : 0;
    }
    samples[i] = sum / channels;
  }
  return { samples, rate };
}

function estimatePitch(samples, rate, center) {
  const stride = Math.max(1, Math.floor(rate / 12000));
  const reducedRate = rate / stride;
  const size = Math.max(256, Math.round(reducedRate * 0.04));
  const minLag = Math.max(2, Math.floor(reducedRate / 1000));
  const maxLag = Math.min(Math.floor(reducedRate / 65), size - 2);
  const frame = new Float32Array(size + maxLag);
  const first = center - Math.floor((size + maxLag) * stride / 2);
  let energy = 0;
  for (let i = 0; i < frame.length; i++) {
    const at = first + i * stride;
    const value = at >= 0 && at < samples.length ? samples[at] : 0;
    frame[i] = value;
    if (i < size) energy += value * value;
  }
  const amplitude = Math.sqrt(energy / size);
  if (amplitude < 0.003) return { pitch: 0, amplitude };
  const differences = new Float64Array(maxLag + 1);
  let accumulated = 0;
  let bestLag = 0;
  let bestValue = Infinity;
  for (let lag = 1; lag <= maxLag; lag++) {
    let difference = 0;
    for (let i = 0; i < size; i++) {
      const delta = frame[i] - frame[i + lag];
      difference += delta * delta;
    }
    accumulated += difference;
    const normalized = difference * lag / Math.max(accumulated, 1e-12);
    differences[lag] = normalized;
    if (lag >= minLag && normalized < bestValue) { bestValue = normalized; bestLag = lag; }
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (differences[lag] < 0.12 && (lag === maxLag || differences[lag] <= differences[lag + 1])) { bestLag = lag; break; }
  }
  if (!bestLag || differences[bestLag] > 0.25) return { pitch: 0, amplitude };
  const before = differences[bestLag - 1] || differences[bestLag];
  const after = differences[bestLag + 1] || differences[bestLag];
  const denominator = before - 2 * differences[bestLag] + after;
  const correction = denominator ? Math.max(-0.5, Math.min(0.5, (before - after) / (2 * denominator))) : 0;
  return { pitch: reducedRate / (bestLag + correction), amplitude };
}

async function encodeFrq(samples, rate) {
  const count = Math.ceil(samples.length / HOP);
  if (count > 2000000) throw new Error('WAVが長すぎます');
  const output = Buffer.alloc(40 + count * 16);
  output.write('FREQ0003', 0, 'ascii');
  output.writeInt32LE(HOP, 8);
  output.write('UTAU Setup', 20, 'ascii');
  output.writeInt32LE(count, 36);
  const pitches = [];
  for (let i = 0; i < count; i++) {
    const { pitch, amplitude } = estimatePitch(samples, rate, i * HOP);
    output.writeDoubleLE(pitch, 40 + i * 16);
    output.writeDoubleLE(amplitude * 32768, 48 + i * 16);
    if (pitch > 0) pitches.push(pitch);
    if (i % 24 === 23) await new Promise(resolve => setImmediate(resolve));
  }
  pitches.sort((a, b) => a - b);
  output.writeDoubleLE(pitches.length ? pitches[Math.floor(pitches.length / 2)] : 0, 12);
  return output;
}

async function generateFrqs(root, overwrite, progress) {
  if (await fs.realpath(root) !== root) throw new Error('音源フォルダが変更されました');
  if (activeRoots.has(root)) throw new Error('FRQを生成中です');
  activeRoots.add(root);
  try { return await generateFrqsLocked(root, overwrite, progress); }
  finally { activeRoots.delete(root); }
}

async function generateFrqsLocked(root, overwrite, progress) {
  const wavs = await listWavs(root);
  const result = { generated: 0, skipped: 0, failed: 0, errors: [] };
  for (let index = 0; index < wavs.length; index++) {
    const wav = wavs[index];
    const standardTarget = wav.replace(/\.wav$/i, '_wav.frq');
    const alternativeTarget = `${wav}.frq`;
    try {
      const parent = await fs.realpath(path.dirname(wav));
      const relativeParent = path.relative(root, parent);
      if (relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) throw new Error('音源フォルダ外のWAVは処理できません');
      if (await fs.realpath(wav) !== wav) throw new Error('リンク先のWAVは処理できません');
      const wavStat = await fs.lstat(wav);
      if (!wavStat.isFile() || wavStat.isSymbolicLink() || wavStat.size > MAX_WAV_BYTES) throw new Error('WAVが大きすぎるか通常のファイルではありません');
      let existing = null;
      let target = standardTarget;
      try { existing = await fs.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!existing) {
        try { existing = await fs.lstat(alternativeTarget); target = alternativeTarget; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('FRQの保存先が通常のファイルではありません');
      if (existing && !overwrite) { result.skipped++; continue; }
      const { samples, rate } = decodeWav(await fs.readFile(wav));
      const output = await encodeFrq(samples, rate);
      if (await fs.realpath(root) !== root) throw new Error('音源フォルダが変更されました');
      if (await fs.realpath(path.dirname(wav)) !== parent) throw new Error('処理中にフォルダが変更されました');
      const currentWav = await fs.lstat(wav);
      if (currentWav.size !== wavStat.size || currentWav.mtimeMs !== wavStat.mtimeMs) throw new Error('処理中にWAVが変更されました');
      let currentTarget = null;
      try { currentTarget = await fs.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (Boolean(currentTarget) !== Boolean(existing) || (existing && (currentTarget.size !== existing.size || currentTarget.mtimeMs !== existing.mtimeMs || currentTarget.isSymbolicLink()))) throw new Error('処理中にFRQが変更されました');
      const temp = `${target}.tmp-${crypto.randomUUID()}`;
      try {
        await fs.writeFile(temp, output, { flag: 'wx' });
        await fs.rename(temp, target);
      } catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
      result.generated++;
    } catch (error) {
      result.failed++;
      if (result.errors.length < 8) result.errors.push(`${path.relative(root, wav)}: ${error.message}`);
    } finally { progress?.({ current: index + 1, total: wavs.length, generated: result.generated, failed: result.failed }); }
  }
  return { ...result, total: wavs.length };
}

module.exports = { listWavs, generateFrqs };
