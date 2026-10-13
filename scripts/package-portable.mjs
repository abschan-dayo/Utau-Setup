import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

if (process.platform !== 'win32') throw new Error('Windows上で実行してください');

const cache = path.resolve('node_modules', '.cache', 'electron');
const temp = path.resolve('node_modules', '.cache', 'portable-temp');
await fs.mkdir(cache, { recursive: true });
await fs.mkdir(temp, { recursive: true });

const cli = path.resolve('node_modules', 'electron-builder', 'cli.js');
const child = spawn(process.execPath, [cli, '--win', 'portable', '--x64'], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_BUILDER_CACHE: cache, ELECTRON_CACHE: cache, TEMP: temp, TMP: temp, TMPDIR: temp },
  stdio: 'inherit'
});

const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
});
if (code !== 0) process.exit(code || 1);

const packageInfo = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8'));
const outputRoot = await fs.realpath(path.resolve('release-portable'));
const workspaceRoot = await fs.realpath(process.cwd());
const relativeOutput = path.relative(workspaceRoot, outputRoot);
if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('配布先を確認できません');
const artifactName = `${packageInfo.productName}-${packageInfo.version}-win-x64-portable.exe`;
const artifact = (await fs.readdir(outputRoot)).find(name => name.normalize('NFC') === artifactName);
if (!artifact) throw new Error('ポータブルEXEを確認できません');
const bundle = path.join(outputRoot, `${packageInfo.productName}-portable`);
if (path.dirname(bundle) !== outputRoot) throw new Error('配布フォルダを確認できません');
const existing = await fs.lstat(bundle).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
if (existing) {
  if (!existing.isDirectory() || existing.isSymbolicLink() || await fs.realpath(bundle) !== bundle) throw new Error('既存の配布フォルダを置き換えられません');
  await fs.rm(bundle, { recursive: true });
}
await fs.mkdir(bundle);
await fs.rename(path.join(outputRoot, artifact), path.join(bundle, `${packageInfo.productName}.exe`));
await fs.mkdir(path.join(bundle, 'plugins'));
await fs.cp(path.resolve('builtin-plugins', 'release-checker'), path.join(bundle, 'plugins', 'release-checker'), { recursive: true });
console.log(bundle);
