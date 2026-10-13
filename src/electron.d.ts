import type { AssetSaveResult, Character, FrequencyFile, FrqFolderPitch, FrqGenerationResult, FrqGenerationProgress, NewVoicebankAnalysis, NotificationSound, PhonemizerSaveResult, PhonemizerSetting, PickedAsset, PickedMoresampler, PortraitSettings, PortraitSettingsSaveResult, PrefixEntry, PrefixMap, PrefixSaveResult, ReadFile, ReadmeFile, SaveResult, Voicebank, VoicebankFiles, VoiceColors, VoiceColorRow } from './voicebank';
import type { PluginManifest } from './plugin-runtime';

declare global {
  interface Window {
    voicebankApi: {
      getAppInfo(): Promise<{ version: string; packaged: boolean; platform: string; arch: string; cpu: string; electron: string; pluginApiVersion: number }>;
      listPlugins(): Promise<PluginManifest[]>;
      exportPluginTemplate(): Promise<boolean>;
      installPlugin(): Promise<boolean>;
      removePlugin(id: string): Promise<boolean>;
      beginPluginRun(id: string, commandId: string, voicebankId: string): Promise<{ runId: string; source: string; voicebank: { name: string } } | null>;
      callPluginApi(runId: string, method: string, args: unknown[]): Promise<unknown>;
      endPluginRun(runId: string): Promise<{ wrote: boolean }>;
      pickFolder(id?: string): Promise<string | null>;
      readCompletionWav(): Promise<string>;
      readNotificationWav(kind: Exclude<NotificationSound, 'save'>): Promise<string>;
      pickNewDestination(): Promise<{ token: string; path: string } | null>;
      analyzeNewSources(paths: string[]): Promise<NewVoicebankAnalysis>;
      createNewVoicebank(sourceToken: string, destinationToken: string, name: string, multi: boolean): Promise<{ path: string; wavCount: number; multi: boolean }>;
      openVoicebank(path: string): Promise<Voicebank>;
      createReadme(id: string): Promise<{ created: boolean }>;
      readReadme(id: string): Promise<ReadmeFile>;
      saveReadme(id: string, value: string): Promise<{ saved: boolean; message?: string }>;
      listVoicebankFiles(id: string): Promise<VoicebankFiles>;
      findReadFiles(id: string): Promise<ReadFile[]>;
      deleteReadFiles(id: string): Promise<{ deleted: number; readFiles: ReadFile[] }>;
      readVoiceColors(id: string): Promise<VoiceColors>;
      saveVoiceColors(id: string, rows: VoiceColorRow[]): Promise<{ saved: boolean; message?: string; rows: VoiceColorRow[] }>;
      saveCharacter(id: string, changes: Partial<Character>): Promise<SaveResult>;
      saveYamlCharacter(id: string, changes: Partial<Character>): Promise<SaveResult>;
      readPrefixMap(id: string): Promise<PrefixMap>;
      savePrefixMap(id: string, entries: PrefixEntry[]): Promise<PrefixSaveResult>;
      readPhonemizer(id: string): Promise<PhonemizerSetting>;
      savePhonemizer(id: string, value: string): Promise<PhonemizerSaveResult>;
      readPitchSources(id: string): Promise<PrefixEntry[]>;
      readFrqFolderPitches(id: string): Promise<FrqFolderPitch[]>;
      readFrequencyFiles(id: string): Promise<FrequencyFile[]>;
      generateFrqs(id: string, overwrite: boolean): Promise<FrqGenerationResult>;
      onFrqProgress(callback: (progress: FrqGenerationProgress) => void): () => void;
      pickMoresampler(): Promise<PickedMoresampler | null>;
      generateLlsms(id: string, token: string, overwrite: boolean): Promise<FrqGenerationResult>;
      onLlsmProgress(callback: (progress: FrqGenerationProgress) => void): () => void;
      deleteFrequencyFile(id: string, relativePath: string): Promise<{ deleted: boolean; files: FrequencyFile[] }>;
      deleteFrequencyFilesByExtension(id: string, extension: FrequencyFile['extension']): Promise<{ deleted: number; files: FrequencyFile[] }>;
      savePortraitSettings(id: string, settings: PortraitSettings): Promise<PortraitSettingsSaveResult>;
      getDroppedPath(file: File): string;
      readAsset(id: string, kind: 'icon' | 'portrait' | 'icon-txt' | 'icon-yaml'): Promise<string | null>;
      pickAsset(id: string): Promise<PickedAsset | null>;
      saveAsset(id: string, kind: 'icon' | 'portrait', token: string, iconTarget?: 'txt' | 'yaml' | 'both'): Promise<AssetSaveResult>;
    };
  }
}
