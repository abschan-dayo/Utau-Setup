const { app, BrowserWindow, dialog, ipcMain, session, nativeImage } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const { decodeBmp } = require('./bmp.cjs');
const { analyzeSources, createVoicebank } = require('./new-voicebank.cjs');
const { randomUUID } = require('node:crypto');
const { openVoicebank, getVoicebankRoot, createReadme, readReadme, saveReadme, listVoicebankFiles, findReadFiles, deleteReadFiles, readVoiceColors, saveVoiceColors, saveCharacter, saveYamlCharacter, readPrefixMap, savePrefixMap, readPhonemizer, savePhonemizer, readPitchSources, readFrqFolderPitches, readFrequencyFiles, deleteFrequencyFile, deleteFrequencyFilesByExtension, savePortraitSettings, getAssetPath, saveAsset } = require('./voicebank.cjs');
const { generateFrqs } = require('./frq.cjs');
const { generateLlsms } = require('./llsm.cjs');
const { createPluginManager, PLUGIN_API_VERSION } = require('./plugins.cjs');

const appName = 'ふっきんちゃんが一晩でやってくれました';
app.setName(appName);
const defaultUserDataPath = app.getPath('userData');
let userDataPath = defaultUserDataPath;
let pluginDirectory = path.join(userDataPath, 'plugins');
if (process.platform === 'win32' && app.isPackaged) {
  const parent = path.resolve(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath));
  const data = path.join(parent, 'data');
  const cache = path.join(parent, 'cache');
  const logs = path.join(parent, 'logs');
  const plugins = path.join(parent, 'plugins');
  try {
    for (const folder of [data, cache, logs, plugins, path.join(logs, 'crashes')]) mkdirSync(folder, { recursive: true });
    userDataPath = data;
    pluginDirectory = plugins;
    app.setPath('sessionData', cache);
    app.setAppLogsPath(logs);
    app.setPath('crashDumps', path.join(logs, 'crashes'));
  } catch { /* 書き込み不可の場所から起動した場合はOS標準の保存先を使う */ }
}
mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

let window;
const selectedImages = new Map();
const newSources = new Map();
const newDestinations = new Map();
const selectedMoresamplers = new Map();
const plugins = createPluginManager(pluginDirectory, path.join(__dirname, '..', 'builtin-plugins'), options => dialog.showMessageBox(window, options), getVoicebankRoot);
const notificationWavs = Object.freeze({
  load: 'load.wav',
  error: 'error.wav',
  'frq-generate': 'frq-generate.wav',
  'llsm-generate': 'llsm-generate.wav',
  'moresampler-select': 'moresampler-select.wav',
  'voicecolor-settings': 'voicecolor-settings.wav',
  'image-settings': 'image-settings.wav',
  'frq-delete-confirm': 'frq-delete-confirm.wav'
});

async function loadImage(file) {
  const bytes = await fs.readFile(file);
  let image = nativeImage.createFromBuffer(bytes);
  const isBmp = bytes.length >= 2 && bytes.toString('ascii', 0, 2) === 'BM';
  if (image.isEmpty() && isBmp) {
    const decoded = decodeBmp(bytes);
    if (decoded) image = nativeImage.createFromBitmap(decoded.bitmap, { width: decoded.width, height: decoded.height });
  }
  return { image, dataUrl: image.isEmpty() ? isBmp ? `data:image/bmp;base64,${bytes.toString('base64')}` : null : image.toDataURL() };
}

function assertWindow(event) {
  if (!window || event.sender !== window.webContents) throw new Error('この画面から操作してください');
}

function createWindow() {
  window = new BrowserWindow({
    title: appName,
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 620,
    backgroundColor: '#f5f6f8',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ipcMain.handle('app:info', event => {
    assertWindow(event);
    return { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model?.trim() || '取得できません', electron: process.versions.electron, pluginApiVersion: PLUGIN_API_VERSION };
  });
  ipcMain.handle('plugin:list', event => { assertWindow(event); return plugins.list(); });
  ipcMain.handle('plugin:export-template', async event => {
    assertWindow(event);
    const result = await dialog.showOpenDialog(window, { title: '雛形の保存先を選択', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return false;
    const source = path.join(__dirname, '..', 'plugin-template');
    const target = path.join(result.filePaths[0], 'utau-plugin-template');
    if (await fs.lstat(target).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))) throw new Error('保存先に同名の雛形フォルダがあります');
    await fs.mkdir(target);
    try {
      for (const filename of ['plugin.json', 'main.js', 'plugin-api.d.ts', 'PLUGIN_API.md']) {
        await fs.copyFile(path.join(source, filename), path.join(target, filename));
      }
    } catch (error) { await fs.rm(target, { recursive: true, force: true }); throw error; }
    return true;
  });
  ipcMain.handle('plugin:install', async event => {
    assertWindow(event);
    const result = await dialog.showOpenDialog(window, { title: 'プラグインフォルダを選択', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return false;
    return plugins.install(result.filePaths[0]);
  });
  ipcMain.handle('plugin:remove', (event, id) => { assertWindow(event); return plugins.remove(id); });
  ipcMain.handle('plugin:begin', (event, id, commandId, voicebankId) => { assertWindow(event); return plugins.begin(id, commandId, voicebankId); });
  ipcMain.handle('plugin:call', (event, runId, method, args) => { assertWindow(event); return plugins.call(runId, method, args); });
  ipcMain.handle('plugin:end', (event, runId) => { assertWindow(event); return plugins.end(runId); });
  ipcMain.handle('folder:pick', async (event, id) => {
    assertWindow(event);
    const defaultPath = getVoicebankRoot(id);
    const result = await dialog.showOpenDialog(window, { title: '音源フォルダを選択', properties: ['openDirectory'], ...(defaultPath ? { defaultPath } : {}) });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('sound:read', async event => {
    assertWindow(event);
    return (await fs.readFile(path.join(__dirname, '..', 'assets', 'completion.wav'))).toString('base64');
  });
  ipcMain.handle('sound:read-kind', async (event, kind) => {
    assertWindow(event);
    if (typeof kind !== 'string' || !Object.hasOwn(notificationWavs, kind)) throw new Error('通知音の種類が不正です');
    return (await fs.readFile(path.join(__dirname, '..', 'assets', 'notifications', notificationWavs[kind]))).toString('base64');
  });
  ipcMain.handle('new:pick-destination', async event => {
    assertWindow(event);
    const result = await dialog.showOpenDialog(window, { title: '新規音源の保存先を選択', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const token = randomUUID();
    newDestinations.set(token, result.filePaths[0]);
    return { token, path: result.filePaths[0] };
  });
  ipcMain.handle('new:analyze', async (event, paths) => {
    assertWindow(event);
    const plan = await analyzeSources(paths);
    const token = randomUUID();
    newSources.set(token, plan);
    return { token, multi: plan.multi, reason: plan.reason, wavCount: plan.wavCount, folders: plan.folders.slice(0, 30), hasCharacter: plan.hasCharacter, hasReadme: plan.hasReadme, totalBytes: plan.totalBytes };
  });
  ipcMain.handle('new:create', async (event, sourceToken, destinationToken, name, multi) => {
    assertWindow(event);
    const plan = newSources.get(sourceToken);
    const parent = newDestinations.get(destinationToken);
    if (!plan || !parent) throw new Error('録音ファイルと保存先を選び直してください');
    const result = await createVoicebank(plan, parent, name, multi);
    newSources.delete(sourceToken);
    newDestinations.delete(destinationToken);
    return result;
  });
  ipcMain.handle('voicebank:open', (event, folder) => { assertWindow(event); return openVoicebank(folder); });
  ipcMain.handle('voicebank:create-readme', (event, id) => { assertWindow(event); return createReadme(id); });
  ipcMain.handle('voicebank:read-readme', (event, id) => { assertWindow(event); return readReadme(id); });
  ipcMain.handle('voicebank:save-readme', (event, id, value) => { assertWindow(event); return saveReadme(id, value); });
  ipcMain.handle('voicebank:files', (event, id) => { assertWindow(event); return listVoicebankFiles(id); });
  ipcMain.handle('voicebank:read-files', (event, id) => { assertWindow(event); return findReadFiles(id); });
  ipcMain.handle('voicebank:delete-read-files', async (event, id) => {
    assertWindow(event);
    const files = await findReadFiles(id);
    if (!files.length) return { deleted: 0, readFiles: [] };
    const details = files.slice(0, 12).map(file => file.path).join('\n');
    const answer = await dialog.showMessageBox(window, {
      type: 'warning', title: '$readの削除', message: `$read ${files.length}件を削除しますか？`,
      detail: `${details}${files.length > 12 ? `\nほか ${files.length - 12}件` : ''}`,
      buttons: ['キャンセル', '削除'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (answer.response !== 1) return { deleted: 0, readFiles: files };
    return deleteReadFiles(id, files);
  });
  ipcMain.handle('voicebank:colors', (event, id) => { assertWindow(event); return readVoiceColors(id); });
  ipcMain.handle('voicebank:colors-save', (event, id, rows) => { assertWindow(event); return saveVoiceColors(id, rows); });
  ipcMain.handle('voicebank:save', (event, id, changes) => { assertWindow(event); return saveCharacter(id, changes); });
  ipcMain.handle('voicebank:save-yaml', (event, id, changes) => { assertWindow(event); return saveYamlCharacter(id, changes); });
  ipcMain.handle('prefixmap:read', (event, id) => { assertWindow(event); return readPrefixMap(id); });
  ipcMain.handle('prefixmap:save', (event, id, entries) => { assertWindow(event); return savePrefixMap(id, entries); });
  ipcMain.handle('phonemizer:read', (event, id) => { assertWindow(event); return readPhonemizer(id); });
  ipcMain.handle('phonemizer:save', (event, id, value) => { assertWindow(event); return savePhonemizer(id, value); });
  ipcMain.handle('pitchmap:sources', (event, id) => { assertWindow(event); return readPitchSources(id); });
  ipcMain.handle('pitchmap:frq-folders', (event, id) => { assertWindow(event); return readFrqFolderPitches(id); });
  ipcMain.handle('frequency:list', (event, id) => { assertWindow(event); return readFrequencyFiles(id); });
  ipcMain.handle('frequency:generate', async (event, id, overwrite) => {
    assertWindow(event);
    const root = getVoicebankRoot(id);
    if (!root || typeof overwrite !== 'boolean') throw new Error('音源を開き直してください');
    if (overwrite) {
      const answer = await dialog.showMessageBox(window, {
        type: 'warning', title: 'FRQの再生成', message: '既存のFRQも再生成しますか？',
        detail: '既存のFRQを置き換えます。',
        buttons: ['キャンセル', '再生成'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (answer.response !== 1) return { canceled: true, generated: 0, skipped: 0, failed: 0, errors: [], total: 0, files: await readFrequencyFiles(id) };
    }
    const result = await generateFrqs(root, overwrite, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('frequency:progress', { id, ...progress });
    });
    return { ...result, canceled: false, files: await readFrequencyFiles(id) };
  });
  ipcMain.handle('frequency:pick-moresampler', async event => {
    assertWindow(event);
    const result = await dialog.showOpenDialog(window, { title: 'Moresamplerを選択', properties: ['openFile'], filters: [{ name: 'Moresampler', extensions: ['exe'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const executable = await fs.realpath(result.filePaths[0]);
    const stat = await fs.lstat(executable);
    if (!stat.isFile() || stat.isSymbolicLink() || !/moresampler(?:64)?\.exe$/i.test(path.basename(executable))) throw new Error('moresampler.exeを選択してください');
    const token = randomUUID();
    selectedMoresamplers.clear();
    selectedMoresamplers.set(token, executable);
    return { token, name: path.basename(executable) };
  });
  ipcMain.handle('frequency:generate-llsm', async (event, id, token, overwrite) => {
    assertWindow(event);
    const root = getVoicebankRoot(id);
    const executable = selectedMoresamplers.get(token);
    if (!root || !executable || typeof overwrite !== 'boolean') throw new Error('音源とMoresamplerを選び直してください');
    if (overwrite) {
      const answer = await dialog.showMessageBox(window, {
        type: 'warning', title: 'LLSMの再生成', message: '既存のLLSMも再生成しますか？',
        detail: '既存のLLSMを置き換えます。',
        buttons: ['キャンセル', '再生成'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (answer.response !== 1) return { canceled: true, generated: 0, skipped: 0, failed: 0, errors: [], total: 0, files: await readFrequencyFiles(id) };
    }
    const result = await generateLlsms(root, executable, overwrite, progress => {
      if (!event.sender.isDestroyed()) event.sender.send('frequency:llsm-progress', { id, ...progress });
    });
    return { ...result, canceled: false, files: await readFrequencyFiles(id) };
  });
  ipcMain.handle('frequency:delete', async (event, id, relativePath) => {
    assertWindow(event);
    if (typeof relativePath === 'string' && path.extname(relativePath).toLowerCase() === '.frq') {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'FRQファイルの削除',
        message: 'このFRQファイルを削除しますか？',
        detail: `${path.basename(relativePath)}\nFRQの削除は非推奨です。再生成が必要になる場合があります。\n削除したファイルは元に戻せません。`,
        buttons: ['キャンセル', '削除'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      if (result.response !== 1) return { deleted: false, files: await readFrequencyFiles(id) };
    }
    return { deleted: true, files: await deleteFrequencyFile(id, relativePath) };
  });
  ipcMain.handle('frequency:delete-extension', async (event, id, extension) => {
    assertWindow(event);
    const files = (await readFrequencyFiles(id)).filter(file => file.extension === extension);
    if (!files.length) return { deleted: 0, files: await readFrequencyFiles(id) };
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      title: `${extension.toUpperCase()}ファイルの一括削除`,
      message: `${extension.toUpperCase()}ファイル ${files.length}件を削除しますか？`,
      detail: `${extension === '.frq' ? 'FRQの削除は非推奨です。再生成が必要になる場合があります。\n' : ''}この拡張子のファイルだけを削除します。削除したファイルは元に戻せません。`,
      buttons: ['キャンセル', '削除'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (result.response !== 1) return { deleted: 0, files: await readFrequencyFiles(id) };
    return deleteFrequencyFilesByExtension(id, extension);
  });
  ipcMain.handle('portrait:save-settings', (event, id, settings) => { assertWindow(event); return savePortraitSettings(id, settings); });
  ipcMain.handle('asset:read', async (event, id, kind) => {
    assertWindow(event);
    const file = await getAssetPath(id, kind);
    if (!file) return null;
    return (await loadImage(file)).dataUrl;
  });
  ipcMain.handle('asset:pick', async (event, id) => {
    assertWindow(event);
    const defaultPath = getVoicebankRoot(id);
    const result = await dialog.showOpenDialog(window, { title: '画像を選択', properties: ['openFile'], filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }], ...(defaultPath ? { defaultPath } : {}) });
    if (result.canceled || !result.filePaths[0]) return null;
    const token = require('node:crypto').randomUUID();
    selectedImages.set(token, result.filePaths[0]);
    const { dataUrl } = await loadImage(result.filePaths[0]);
    return { token, name: path.basename(result.filePaths[0]), dataUrl };
  });
  ipcMain.handle('asset:save', async (event, id, kind, token, iconTarget) => {
    assertWindow(event);
    const source = selectedImages.get(token);
    if (!source) throw new Error('画像を選び直してください');
    let convertedBmp = null;
    if (kind === 'icon' && iconTarget === 'txt') {
      const { image } = await loadImage(source);
      if (image.isEmpty()) throw new Error('選択した画像を読み込めません');
      const size = image.getSize();
      const edge = Math.min(size.width, size.height);
      const square = image.crop({ x: Math.floor((size.width - edge) / 2), y: Math.floor((size.height - edge) / 2), width: edge, height: edge });
      const pixels = square.resize({ width: 100, height: 100, quality: 'best' }).toBitmap();
      const rowBytes = 100 * 4;
      const header = Buffer.alloc(54);
      header.write('BM', 0, 'ascii');
      header.writeUInt32LE(54 + rowBytes * 100, 2);
      header.writeUInt32LE(54, 10);
      header.writeUInt32LE(40, 14);
      header.writeInt32LE(100, 18);
      header.writeInt32LE(100, 22);
      header.writeUInt16LE(1, 26);
      header.writeUInt16LE(32, 28);
      header.writeUInt32LE(0, 30);
      header.writeUInt32LE(rowBytes * 100, 34);
      const bottomUpPixels = Buffer.alloc(rowBytes * 100);
      const bitmapPixels = Buffer.from(pixels);
      for (let row = 0; row < 100; row++) {
        bitmapPixels.copy(bottomUpPixels, row * rowBytes, (99 - row) * rowBytes, (100 - row) * rowBytes);
      }
      convertedBmp = Buffer.concat([header, bottomUpPixels]);
    }
    const result = await saveAsset(id, kind, source, iconTarget, convertedBmp);
    selectedImages.delete(token);
    return result;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
