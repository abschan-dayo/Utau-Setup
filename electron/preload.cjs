const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('voicebankApi', {
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  listPlugins: () => ipcRenderer.invoke('plugin:list'),
  exportPluginTemplate: () => ipcRenderer.invoke('plugin:export-template'),
  installPlugin: () => ipcRenderer.invoke('plugin:install'),
  removePlugin: id => ipcRenderer.invoke('plugin:remove', id),
  beginPluginRun: (id, commandId, voicebankId) => ipcRenderer.invoke('plugin:begin', id, commandId, voicebankId),
  callPluginApi: (runId, method, args) => ipcRenderer.invoke('plugin:call', runId, method, args),
  endPluginRun: runId => ipcRenderer.invoke('plugin:end', runId),
  pickFolder: id => ipcRenderer.invoke('folder:pick', id),
  readCompletionWav: () => ipcRenderer.invoke('sound:read'),
  readNotificationWav: kind => ipcRenderer.invoke('sound:read-kind', kind),
  pickNewDestination: () => ipcRenderer.invoke('new:pick-destination'),
  analyzeNewSources: paths => ipcRenderer.invoke('new:analyze', paths),
  createNewVoicebank: (sourceToken, destinationToken, name, multi) => ipcRenderer.invoke('new:create', sourceToken, destinationToken, name, multi),
  openVoicebank: path => ipcRenderer.invoke('voicebank:open', path),
  createReadme: id => ipcRenderer.invoke('voicebank:create-readme', id),
  readReadme: id => ipcRenderer.invoke('voicebank:read-readme', id),
  saveReadme: (id, value) => ipcRenderer.invoke('voicebank:save-readme', id, value),
  listVoicebankFiles: id => ipcRenderer.invoke('voicebank:files', id),
  findReadFiles: id => ipcRenderer.invoke('voicebank:read-files', id),
  deleteReadFiles: id => ipcRenderer.invoke('voicebank:delete-read-files', id),
  readVoiceColors: id => ipcRenderer.invoke('voicebank:colors', id),
  saveVoiceColors: (id, rows) => ipcRenderer.invoke('voicebank:colors-save', id, rows),
  saveCharacter: (id, changes) => ipcRenderer.invoke('voicebank:save', id, changes),
  saveYamlCharacter: (id, changes) => ipcRenderer.invoke('voicebank:save-yaml', id, changes),
  readPrefixMap: id => ipcRenderer.invoke('prefixmap:read', id),
  savePrefixMap: (id, entries) => ipcRenderer.invoke('prefixmap:save', id, entries),
  readPhonemizer: id => ipcRenderer.invoke('phonemizer:read', id),
  savePhonemizer: (id, value) => ipcRenderer.invoke('phonemizer:save', id, value)
  ,readPitchSources: id => ipcRenderer.invoke('pitchmap:sources', id)
  ,readFrqFolderPitches: id => ipcRenderer.invoke('pitchmap:frq-folders', id)
  ,readFrequencyFiles: id => ipcRenderer.invoke('frequency:list', id)
  ,generateFrqs: (id, overwrite) => ipcRenderer.invoke('frequency:generate', id, overwrite)
  ,onFrqProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('frequency:progress', listener);
    return () => ipcRenderer.removeListener('frequency:progress', listener);
  }
  ,pickMoresampler: () => ipcRenderer.invoke('frequency:pick-moresampler')
  ,generateLlsms: (id, token, overwrite) => ipcRenderer.invoke('frequency:generate-llsm', id, token, overwrite)
  ,onLlsmProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('frequency:llsm-progress', listener);
    return () => ipcRenderer.removeListener('frequency:llsm-progress', listener);
  }
  ,deleteFrequencyFile: (id, relativePath) => ipcRenderer.invoke('frequency:delete', id, relativePath)
  ,deleteFrequencyFilesByExtension: (id, extension) => ipcRenderer.invoke('frequency:delete-extension', id, extension)
  ,savePortraitSettings: (id, settings) => ipcRenderer.invoke('portrait:save-settings', id, settings)
  ,getDroppedPath: file => webUtils.getPathForFile(file)
  ,readAsset: (id, kind) => ipcRenderer.invoke('asset:read', id, kind)
  ,pickAsset: id => ipcRenderer.invoke('asset:pick', id)
  ,saveAsset: (id, kind, token, iconTarget) => ipcRenderer.invoke('asset:save', id, kind, token, iconTarget)
});
