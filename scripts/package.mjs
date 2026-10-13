import { packager } from '@electron/packager';
import fs from 'node:fs/promises';
import path from 'node:path';

const platform = process.argv[2];
if (!['win32', 'darwin'].includes(platform)) throw new Error('win32 または darwin を指定してください');
const appName = 'ふっきんちゃんが一晩でやってくれました';
const outputDirectory = process.argv[3] || 'release';
const icon = path.resolve('assets', platform === 'darwin' ? 'icon.icns' : 'icon.ico');
const runtimeAssets = new Set(['assets/completion.wav', 'assets/icon.png']);
const electronCache = path.resolve('node_modules', '.cache', 'electron');

async function cachedElectronZipDirectory() {
  const { version } = JSON.parse(await fs.readFile(path.resolve('node_modules', 'electron', 'package.json'), 'utf8'));
  const archive = `electron-v${version}-${platform}-${process.arch}.zip`;
  for (const entry of await fs.readdir(electronCache, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(electronCache, entry.name);
    const found = await fs.stat(path.join(directory, archive)).catch(() => null);
    if (found?.isFile() && found.size > 0) return directory;
  }
  return null;
}

function ignoreNonRuntimeFile(candidate) {
  const relative = candidate.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!relative || relative === 'package.json') return false;
  if (relative === 'dist' || relative.startsWith('dist/')) return false;
  if (relative === 'electron' || relative.startsWith('electron/')) return false;
  if (relative === 'builtin-plugins' || relative.startsWith('builtin-plugins/')) return false;
  if (relative === 'plugin-template' || relative.startsWith('plugin-template/')) return false;
  if (relative === 'node_modules') return false;
  if (relative.startsWith('node_modules/')) {
    const inside = relative.slice('node_modules/'.length);
    return inside === '.bin' || inside.startsWith('.bin/') || inside === '.cache' || inside.startsWith('.cache/') || inside === '.package-lock.json' || inside === '.vite-temp' || inside.startsWith('.vite-temp/');
  }
  if (relative === 'assets' || relative === 'assets/notifications' || relative.startsWith('assets/notifications/') || runtimeAssets.has(relative)) return false;
  return true;
}

async function keepWindowsLocales({ buildPath, platform: targetPlatform }) {
  if (targetPlatform !== 'win32') return;
  const localesPath = path.join(buildPath, 'locales');
  const retained = new Set(['en-US.pak', 'ja.pak']);
  for (const name of retained) await fs.access(path.join(localesPath, name));
  for (const entry of await fs.readdir(localesPath, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.pak') && !retained.has(entry.name)) {
      await fs.unlink(path.join(localesPath, entry.name));
    }
  }
}

const electronZipDir = await cachedElectronZipDirectory();
const output = await packager({
  dir: process.cwd(),
  out: path.resolve(outputDirectory),
  name: appName,
  win32metadata: { FileDescription: appName, ProductName: appName, InternalName: appName },
  platform,
  arch: process.arch,
  icon,
  ...(electronZipDir
    ? { electronZipDir }
    : { download: { cacheRoot: electronCache } }),
  asar: true,
  prune: true,
  overwrite: true,
  ignore: ignoreNonRuntimeFile,
  afterExtract: [keepWindowsLocales]
});
if (platform === 'win32') {
  const buildPath = output[0];
  const outputRoot = await fs.realpath(path.resolve(outputDirectory));
  if (await fs.realpath(path.dirname(buildPath)) !== outputRoot) throw new Error('配布先が出力フォルダ外です');
  const executableName = `${appName}.exe`;
  const packagedExecutable = (await fs.readdir(buildPath)).find(name => name.endsWith('.exe') && name.normalize('NFC') === executableName);
  if (!packagedExecutable) throw new Error('生成された実行ファイルを確認できません');
  if (packagedExecutable !== executableName) await fs.rename(path.join(buildPath, packagedExecutable), path.join(buildPath, executableName));

  const normalizedPath = path.join(path.dirname(buildPath), `${appName}-win32-${process.arch}`);
  if (path.dirname(normalizedPath) !== path.dirname(buildPath)) throw new Error('配布先が出力フォルダ外です');
  if (buildPath !== normalizedPath) {
    const existing = await fs.lstat(normalizedPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('配布先を置き換えられません');
      await fs.rm(normalizedPath, { recursive: true });
    }
    await fs.rename(buildPath, normalizedPath);
    output[0] = normalizedPath;
  }
  const pluginTarget = path.join(output[0], 'plugins', 'release-checker');
  await fs.mkdir(path.dirname(pluginTarget), { recursive: true });
  await fs.cp(path.resolve('builtin-plugins', 'release-checker'), pluginTarget, { recursive: true, force: true });
}
console.log(output.join('\n'));
