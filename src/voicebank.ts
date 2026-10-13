export type FieldKey = 'name' | 'author' | 'voice' | 'image' | 'version' | 'web';
export type Character = Record<FieldKey, string>;
export type Voicebank = {
  id: string;
  root: string;
  name: string;
  character: Partial<Character>;
  yaml: { exists: boolean; writable: boolean; character: Partial<Character>; warnings: string[] };
  rawText: string;
  encoding: string;
  writable: boolean;
  exists: boolean;
  readmeExists: boolean;
  counts: { wav: number; oto: number; frq: number; llsm: number; pmk: number; folders: number };
  assets: { icon: boolean; portrait: boolean };
  portraitSettings: PortraitSettings;
};
export type ReadmeFile = { exists: boolean; text: string; encoding: string; writable: boolean };
export type FileTreeNode = { name: string; type: 'directory' | 'file'; children?: FileTreeNode[] };
export type VoicebankFiles = { tree: FileTreeNode; count: number; truncated: boolean };
export type ReadFile = { path: string; size: number; mtimeMs: number };
export type VoiceColorRow = { color: string; prefix: string; suffix: string; toneRanges: string[] };
export type VoiceColors = { exists: boolean; writable: boolean; rows: VoiceColorRow[]; warnings: string[] };
export type PortraitSettings = { height: number; opacity: number };
export type FrequencyFile = { path: string; extension: '.frq' | '.llsm' | '.pmk' };
export type FrqGenerationResult = { canceled: boolean; generated: number; skipped: number; failed: number; total: number; errors: string[]; files: FrequencyFile[] };
export type FrqGenerationProgress = { id: string; current: number; total: number; generated: number; failed: number };
export type PickedMoresampler = { token: string; name: string };
export type SaveResult = { saved: boolean; message?: string; character?: Partial<Character>; rawText?: string };
export type PrefixEntry = { note: string; prefix: string; suffix: string };
export type FrqFolderPitch = { folder: string; suffix: string; midi: number; note: string };
export type PrefixMap = { exists: boolean; encoding: string; writable: boolean; entries: PrefixEntry[]; warnings: string[] };
export type PrefixSaveResult = { saved: boolean; message?: string; entries?: PrefixEntry[] };
export type PhonemizerSetting = { exists: boolean; value: string; writable: boolean; warnings: string[] };
export type PhonemizerSaveResult = { saved: boolean; message?: string; value?: string };
export type PortraitSettingsSaveResult = { saved: boolean; message?: string; settings: PortraitSettings };
export type PickedAsset = { token: string; name: string; dataUrl: string | null };
export type AssetSaveResult = { saved: boolean; filename: string; character?: Partial<Character> };
export type SavePendingHandle = { savePending(): Promise<boolean> };
export type NewVoicebankAnalysis = { token: string; multi: boolean; reason: string; wavCount: number; folders: string[]; hasCharacter: boolean; hasReadme: boolean; totalBytes: number };
export type NotificationSound = 'load' | 'save' | 'error' | 'frq-generate' | 'llsm-generate' | 'moresampler-select' | 'voicecolor-settings' | 'image-settings' | 'frq-delete-confirm';

let activeOperations = 0;
let pendingSound: NotificationSound | null = null;
export function playNotification(sound: NotificationSound) {
  window.dispatchEvent(new CustomEvent('utau:notification', { detail: sound }));
}
async function track<T>(operation: () => Promise<T>, sound?: NotificationSound | ((result: T) => NotificationSound | null)): Promise<T> {
  activeOperations++;
  window.dispatchEvent(new CustomEvent('utau:activity', { detail: { active: activeOperations, sound: null } }));
  try {
    const result = await operation();
    const completedSound = typeof sound === 'function' ? sound(result) : sound;
    if (pendingSound !== 'error') pendingSound = completedSound || pendingSound;
    return result;
  } catch (error) {
    pendingSound = 'error';
    throw error;
  }
  finally {
    activeOperations--;
    const nextSound = activeOperations === 0 ? pendingSound : null;
    if (nextSound) pendingSound = null;
    window.dispatchEvent(new CustomEvent('utau:activity', { detail: { active: activeOperations, sound: nextSound } }));
  }
}

export async function pickFolder(id?: string): Promise<string | null> {
  return track(() => window.voicebankApi.pickFolder(id));
}
export async function pickNewDestination(): Promise<{ token: string; path: string } | null> { return track(() => window.voicebankApi.pickNewDestination()); }
export async function analyzeNewSources(paths: string[]): Promise<NewVoicebankAnalysis> { return track(() => window.voicebankApi.analyzeNewSources(paths)); }
export async function createNewVoicebank(sourceToken: string, destinationToken: string, name: string, multi: boolean): Promise<{ path: string; wavCount: number; multi: boolean }> { return track(() => window.voicebankApi.createNewVoicebank(sourceToken, destinationToken, name, multi)); }

export async function openVoicebank(path: string): Promise<Voicebank> {
  return track(() => window.voicebankApi.openVoicebank(path), 'load');
}
export async function createReadme(id: string): Promise<{ created: boolean }> { return track(() => window.voicebankApi.createReadme(id), result => result.created ? 'save' : null); }
export async function readReadme(id: string): Promise<ReadmeFile> { return track(() => window.voicebankApi.readReadme(id)); }
export async function saveReadme(id: string, value: string): Promise<{ saved: boolean; message?: string }> { return track(() => window.voicebankApi.saveReadme(id, value), result => result.saved ? 'save' : null); }

export async function listVoicebankFiles(id: string): Promise<VoicebankFiles> { return track(() => window.voicebankApi.listVoicebankFiles(id)); }
export async function findReadFiles(id: string): Promise<ReadFile[]> { return track(() => window.voicebankApi.findReadFiles(id)); }
export async function deleteReadFiles(id: string): Promise<{ deleted: number; readFiles: ReadFile[] }> { return track(() => window.voicebankApi.deleteReadFiles(id), result => result.deleted ? 'save' : null); }
export async function readVoiceColors(id: string): Promise<VoiceColors> { return track(() => window.voicebankApi.readVoiceColors(id)); }
export async function saveVoiceColors(id: string, rows: VoiceColorRow[]): Promise<{ saved: boolean; message?: string; rows: VoiceColorRow[] }> { return track(() => window.voicebankApi.saveVoiceColors(id, rows), result => result.saved ? 'voicecolor-settings' : null); }

export async function saveCharacter(id: string, changes: Partial<Character>): Promise<SaveResult> {
  return track(() => window.voicebankApi.saveCharacter(id, changes), result => result.saved ? 'save' : null);
}

export async function saveYamlCharacter(id: string, changes: Partial<Character>): Promise<SaveResult> {
  return track(() => window.voicebankApi.saveYamlCharacter(id, changes), result => result.saved ? 'save' : null);
}

export async function readPrefixMap(id: string): Promise<PrefixMap> {
  return track(() => window.voicebankApi.readPrefixMap(id));
}

export async function savePrefixMap(id: string, entries: PrefixEntry[]): Promise<PrefixSaveResult> {
  return track(() => window.voicebankApi.savePrefixMap(id, entries), result => result.saved ? 'save' : null);
}

export async function readPhonemizer(id: string): Promise<PhonemizerSetting> {
  return track(() => window.voicebankApi.readPhonemizer(id));
}

export async function savePhonemizer(id: string, value: string): Promise<PhonemizerSaveResult> {
  return track(() => window.voicebankApi.savePhonemizer(id, value), result => result.saved ? 'save' : null);
}

export async function readPitchSources(id: string): Promise<PrefixEntry[]> { return track(() => window.voicebankApi.readPitchSources(id)); }
export async function readFrqFolderPitches(id: string): Promise<FrqFolderPitch[]> { return track(() => window.voicebankApi.readFrqFolderPitches(id)); }
export async function readFrequencyFiles(id: string): Promise<FrequencyFile[]> { return track(() => window.voicebankApi.readFrequencyFiles(id)); }
export async function generateFrqs(id: string, overwrite: boolean): Promise<FrqGenerationResult> { return track(() => window.voicebankApi.generateFrqs(id, overwrite), result => result.canceled ? null : result.failed ? 'error' : result.generated ? 'frq-generate' : null); }
export function onFrqProgress(callback: (progress: FrqGenerationProgress) => void): () => void { return window.voicebankApi.onFrqProgress(callback); }
export async function pickMoresampler(): Promise<PickedMoresampler | null> { playNotification('moresampler-select'); return track(() => window.voicebankApi.pickMoresampler()); }
export async function generateLlsms(id: string, token: string, overwrite: boolean): Promise<FrqGenerationResult> { return track(() => window.voicebankApi.generateLlsms(id, token, overwrite), result => result.canceled ? null : result.failed ? 'error' : result.generated ? 'llsm-generate' : null); }
export function onLlsmProgress(callback: (progress: FrqGenerationProgress) => void): () => void { return window.voicebankApi.onLlsmProgress(callback); }
export async function deleteFrequencyFile(id: string, relativePath: string): Promise<{ deleted: boolean; files: FrequencyFile[] }> { if (relativePath.toLowerCase().endsWith('.frq')) playNotification('frq-delete-confirm'); return track(() => window.voicebankApi.deleteFrequencyFile(id, relativePath), result => result.deleted ? 'save' : null); }
export async function deleteFrequencyFilesByExtension(id: string, extension: FrequencyFile['extension']): Promise<{ deleted: number; files: FrequencyFile[] }> { if (extension === '.frq') playNotification('frq-delete-confirm'); return track(() => window.voicebankApi.deleteFrequencyFilesByExtension(id, extension), result => result.deleted ? 'save' : null); }
export async function savePortraitSettings(id: string, settings: PortraitSettings): Promise<PortraitSettingsSaveResult> { return track(() => window.voicebankApi.savePortraitSettings(id, settings), result => result.saved ? 'image-settings' : null); }

export function getDroppedPath(file: File): string { return window.voicebankApi.getDroppedPath(file); }
export async function readAsset(id: string, kind: 'icon' | 'portrait' | 'icon-txt' | 'icon-yaml'): Promise<string | null> { return track(() => window.voicebankApi.readAsset(id, kind)); }
export async function pickAsset(id: string): Promise<PickedAsset | null> { return track(() => window.voicebankApi.pickAsset(id)); }
export async function saveAsset(id: string, kind: 'icon' | 'portrait', token: string, iconTarget?: 'txt' | 'yaml' | 'both'): Promise<AssetSaveResult> { return track(() => window.voicebankApi.saveAsset(id, kind, token, iconTarget), 'image-settings'); }
