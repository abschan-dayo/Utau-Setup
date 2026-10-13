import { useEffect, useMemo, useRef, useState } from 'react';
import { getDroppedPath, openVoicebank, pickFolder, playNotification, readAsset, saveCharacter, saveYamlCharacter, type Character, type FieldKey, type NotificationSound, type SavePendingHandle, type Voicebank } from './voicebank';
import PitchMap from './PitchMap';
import Phonemizer from './Phonemizer';
import Images from './Images';
import Frequency from './Frequency';
import VoiceColors from './VoiceColors';
import FileTree from './FileTree';
import NewVoicebank from './NewVoicebank';
import Readme from './Readme';
import SingerPreview from './SingerPreview';
import Plugins from './Plugins';
import type { PluginManifest } from './plugin-runtime';
import appIcon from '../assets/icon.png';

type AppInfo = { version: string; packaged: boolean; platform: string; arch: string; cpu: string; electron: string; pluginApiVersion: number };
type BasePage = 'overview' | 'basic' | 'images' | 'pitch' | 'colors' | 'phonemizer' | 'frequency' | 'cleanup' | 'plugins' | 'settings';
type Page = BasePage | `plugin:${string}`;
type Theme = 'system' | 'light' | 'dark';

const pages: { id: BasePage; label: string; icon: string }[] = [
  { id: 'overview', label: '概要', icon: '▣' },
  { id: 'basic', label: '基本情報', icon: '▤' },
  { id: 'images', label: 'アイコン・立ち絵', icon: '▧' },
  { id: 'pitch', label: 'prifixmap', icon: '♬' },
  { id: 'colors', label: 'VoiceColor', icon: '◉' },
  { id: 'phonemizer', label: 'Phonemizer', icon: '⌘' },
  { id: 'frequency', label: '周波数表', icon: '≋' },
  { id: 'cleanup', label: '階層確認', icon: '▢' },
  { id: 'plugins', label: 'プラグイン管理', icon: '◇' },
  { id: 'settings', label: 'アプリ設定', icon: '⚙' }
];
const pluginPage = (id: string): Page => `plugin:${id}`;
const pluginTabIcon = <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
  <path d="M9.5 16V8h3.2a2.2 2.2 0 0 1 0 4.4H9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
</svg>;
const fieldLabels: { key: FieldKey; label: string; placeholder: string }[] = [
  { key: 'name', label: '音源名', placeholder: '音源名' },
  { key: 'author', label: '制作者', placeholder: '制作者名' },
  { key: 'voice', label: '声の提供者', placeholder: '声の提供者' },
  { key: 'image', label: '画像パス', placeholder: 'icon.bmp' },
  { key: 'version', label: 'バージョン', placeholder: '1.0' },
  { key: 'web', label: 'Webサイト', placeholder: 'https://' }
];
const emptyDraft: Character = { name: '', author: '', voice: '', image: '', version: '', web: '' };

function toDraft(value: Partial<Character>): Character {
  return { ...emptyDraft, ...value };
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('utau-theme') as Theme) || 'system');
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && query.matches));
    update();
    query.addEventListener('change', update);
    localStorage.setItem('utau-theme', theme);
    return () => query.removeEventListener('change', update);
  }, [theme]);
  return [theme, setTheme] as const;
}

export default function App() {
  const [mode, setMode] = useState<'start' | 'existing' | 'new'>('start');
  const [page, setPage] = useState<Page>('overview');
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [theme, setTheme] = useTheme();
  const [bank, setBank] = useState<Voicebank | null>(null);
  const [baseline, setBaseline] = useState<Character>(emptyDraft);
  const [draft, setDraft] = useState<Character>(emptyDraft);
  const [yamlBaseline, setYamlBaseline] = useState<Character>(emptyDraft);
  const [yamlDraft, setYamlDraft] = useState<Character>(emptyDraft);
  const [basicFormat, setBasicFormat] = useState<'txt' | 'yaml'>('txt');
  const [saveDialog, setSaveDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activityCount, setActivityCount] = useState(0);
  const [showWorking, setShowWorking] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  const completionBufferRef = useRef<Promise<AudioBuffer | null> | null>(null);
  const notificationBuffersRef = useRef<Partial<Record<NotificationSound, Promise<AudioBuffer | null>>>>({});
  const bulkSavingRef = useRef(false);
  const [toast, setToast] = useState('');
  const [pitchDirty, setPitchDirty] = useState(false);
  const [colorsDirty, setColorsDirty] = useState(false);
  const [phonemizerDirty, setPhonemizerDirty] = useState(false);
  const [imagesDirty, setImagesDirty] = useState(false);
  const [readmeDirty, setReadmeDirty] = useState(false);
  const [readmeText, setReadmeText] = useState('');
  const [singerPreviewOpen, setSingerPreviewOpen] = useState(false);
  const [bulkDialog, setBulkDialog] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const imagesRef = useRef<SavePendingHandle>(null);
  const readmeRef = useRef<SavePendingHandle>(null);
  const pitchRef = useRef<SavePendingHandle>(null);
  const colorsRef = useRef<SavePendingHandle>(null);
  const phonemizerRef = useRef<SavePendingHandle>(null);
  const [dragging, setDragging] = useState(false);
  const [assetPreviews, setAssetPreviews] = useState<{ icon: string | null; portrait: string | null }>({ icon: null, portrait: null });
  const [previewIcons, setPreviewIcons] = useState<{ txt: string | null; yaml: string | null }>({ txt: null, yaml: null });
  const changes = useMemo(() => Object.fromEntries((Object.keys(draft) as FieldKey[]).filter(key => draft[key] !== baseline[key]).map(key => [key, draft[key]])) as Partial<Character>, [draft, baseline]);
  const yamlChanges = useMemo(() => Object.fromEntries((Object.keys(yamlDraft) as FieldKey[]).filter(key => yamlDraft[key] !== yamlBaseline[key]).map(key => [key, yamlDraft[key]])) as Partial<Character>, [yamlDraft, yamlBaseline]);
  const dirty = Object.keys(changes).length > 0;
  const yamlDirty = Object.keys(yamlChanges).length > 0;
  const anyDirty = dirty || yamlDirty || imagesDirty || readmeDirty || pitchDirty || colorsDirty || phonemizerDirty;

  function playNotificationSound(sound: NotificationSound) {
    try {
      const audio = audioRef.current || new AudioContext();
      audioRef.current = audio;
      void audio.resume().then(async () => {
        const chimeStart = audio.currentTime;
        for (const [frequency, delay] of [[660, 0], [880, 0.12]]) {
          const start = chimeStart + delay;
          const tone = audio.createOscillator();
          const volume = audio.createGain();
          tone.type = 'sine'; tone.frequency.value = frequency;
          volume.gain.setValueAtTime(0.0001, start);
          volume.gain.linearRampToValueAtTime(0.16, start + 0.015);
          volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.17);
          tone.connect(volume).connect(audio.destination);
          tone.start(start); tone.stop(start + 0.18);
        }
        const loadBuffer = async (base64: string | null) => {
          if (!base64) return null;
          const binary = atob(base64);
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          return audio.decodeAudioData(bytes.buffer);
        };
        const recording = sound === 'save'
          ? await (completionBufferRef.current ||= window.voicebankApi.readCompletionWav().then(loadBuffer).catch(() => null))
          : await (notificationBuffersRef.current[sound] ||= window.voicebankApi.readNotificationWav(sound).then(loadBuffer).catch(() => null));
        if (recording) {
          const source = audio.createBufferSource();
          const wavVolume = audio.createGain();
          source.buffer = recording;
          wavVolume.gain.value = 0.7;
          source.connect(wavVolume).connect(audio.destination);
          source.start(Math.max(audio.currentTime, chimeStart + 0.34));
        }
      }).catch(() => {});
    } catch { /* 音声出力がない環境でも操作を続ける */ }
  }

  useEffect(() => {
    void window.voicebankApi.getAppInfo().then(setAppInfo).catch(() => {});
  }, []);
  useEffect(() => {
    void window.voicebankApi.listPlugins().then(setPlugins).catch(error => setToast(String(error instanceof Error ? error.message : error)));
  }, []);
  useEffect(() => {
    if (page.startsWith('plugin:') && !plugins.some(plugin => pluginPage(plugin.id) === page)) setPage('plugins');
  }, [page, plugins]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (anyDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(''), 4200); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    const primeAudio = () => {
      try { audioRef.current ||= new AudioContext(); void audioRef.current.resume().catch(() => {}); }
      catch { /* 音声出力がない環境でも操作を続ける */ }
    };
    window.addEventListener('pointerdown', primeAudio, { once: true, capture: true });
    const onActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ active: number; sound: NotificationSound | null }>).detail;
      setActivityCount(detail.active);
      if (detail.sound && (!bulkSavingRef.current || detail.sound === 'error')) playNotificationSound(detail.sound);
    };
    const onNotification = (event: Event) => playNotificationSound((event as CustomEvent<NotificationSound>).detail);
    window.addEventListener('utau:activity', onActivity);
    window.addEventListener('utau:notification', onNotification);
    return () => { window.removeEventListener('utau:activity', onActivity); window.removeEventListener('utau:notification', onNotification); window.removeEventListener('pointerdown', primeAudio, true); };
  }, []);
  useEffect(() => {
    if (!activityCount && !busy) { setShowWorking(false); return; }
    const timeout = window.setTimeout(() => setShowWorking(true), 120);
    return () => window.clearTimeout(timeout);
  }, [activityCount, busy]);

  async function load(path: string) {
    setBusy(true);
    try {
      const result = await openVoicebank(path);
      setAssetPreviews({ icon: null, portrait: null });
      setPreviewIcons({ txt: null, yaml: null });
      setReadmeText('');
      setSingerPreviewOpen(false);
      setBank(result);
      void Promise.all([readAsset(result.id, 'icon-txt'), readAsset(result.id, 'icon-yaml')]).then(([txt, yaml]) => setPreviewIcons({ txt, yaml })).catch(() => {});
      const values = toDraft(result.character);
      setBaseline(values);
      setDraft(values);
      const yamlValues = toDraft(result.yaml.character);
      setYamlBaseline(yamlValues);
      setYamlDraft(yamlValues);
      setToast(`${result.name} を開きました`);
    } catch (caught) { setToast(String(caught instanceof Error ? caught.message : caught)); }
    finally { setBusy(false); }
  }

  async function chooseFolder() {
    if (anyDirty && !window.confirm('未保存の変更を破棄して別の音源を開きますか？')) return;
    try { const selected = await pickFolder(bank?.id); if (selected) await load(selected); }
    catch (caught) { setToast(String(caught instanceof Error ? caught.message : caught)); }
  }

  async function dropFolder(file: File) {
    const path = getDroppedPath(file);
    if (!path) { playNotification('error'); setToast('音源フォルダを読み取れませんでした'); return; }
    if (anyDirty && !window.confirm('未保存の変更を破棄して別の音源を開きますか？')) return;
    try { await load(path); setMode('existing'); }
    catch (caught) { setToast(String(caught instanceof Error ? caught.message : caught)); }
  }
  const dropFolderRef = useRef(dropFolder);
  dropFolderRef.current = dropFolder;

  useEffect(() => {
    if (mode === 'new') return;
    const hasFiles = (event: globalThis.DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const onDrag = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    };
    const onLeave = (event: globalThis.DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event) && !event.dataTransfer?.files.length) return;
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) void dropFolderRef.current(file);
    };
    window.addEventListener('dragenter', onDrag, true);
    window.addEventListener('dragover', onDrag, true);
    window.addEventListener('dragleave', onLeave, true);
    window.addEventListener('drop', onDrop, true);
    return () => {
      window.removeEventListener('dragenter', onDrag, true);
      window.removeEventListener('dragover', onDrag, true);
      window.removeEventListener('dragleave', onLeave, true);
      window.removeEventListener('drop', onDrop, true);
    };
  }, [mode]);

  function assetChanged(kind: 'icon' | 'portrait', dataUrl: string | null, filename?: string, iconTarget?: 'txt' | 'yaml') {
    setAssetPreviews(previous => ({ ...previous, [kind]: dataUrl }));
    if (kind === 'icon' && iconTarget) setPreviewIcons(previous => ({ ...previous, [iconTarget]: dataUrl }));
    if (kind === 'icon' && filename) {
      setBank(previous => previous ? { ...previous, character: iconTarget === 'txt' ? { ...previous.character, image: filename } : previous.character, yaml: iconTarget === 'yaml' ? { ...previous.yaml, exists: true, character: { ...previous.yaml.character, image: filename } } : previous.yaml, assets: { ...previous.assets, icon: true } } : previous);
      if (iconTarget === 'txt') { setBaseline(previous => ({ ...previous, image: filename })); setDraft(previous => ({ ...previous, image: filename })); }
      if (iconTarget === 'yaml') { setYamlBaseline(previous => ({ ...previous, image: filename })); setYamlDraft(previous => ({ ...previous, image: filename })); }
    }
    if (kind === 'portrait' && filename) setBank(previous => previous ? { ...previous, assets: { ...previous.assets, portrait: true } } : previous);
  }

  function portraitSettingsChanged(portraitSettings: Voicebank['portraitSettings']) {
    setBank(previous => previous ? { ...previous, portraitSettings } : previous);
  }

  async function save(format: 'txt' | 'yaml' = basicFormat): Promise<boolean> {
    const activeChanges = format === 'txt' ? changes : yamlChanges;
    if (!bank || !Object.keys(activeChanges).length) return true;
    setBusy(true);
    try {
      const result = format === 'txt' ? await saveCharacter(bank.id, activeChanges) : await saveYamlCharacter(bank.id, activeChanges);
      if (result.character) {
        const savedCharacter = result.character;
        const values = toDraft(savedCharacter);
        if (format === 'txt') {
          setBank(previous => previous ? { ...previous, exists: true, character: savedCharacter, rawText: result.rawText || previous.rawText } : previous);
          setBaseline(values);
          setDraft(values);
        } else {
          setBank(previous => previous ? { ...previous, yaml: { ...previous.yaml, exists: true, character: savedCharacter } } : previous);
          setYamlBaseline(values);
          setYamlDraft(values);
        }
      }
      const icon = await readAsset(bank.id, 'icon');
      setAssetPreviews(previous => ({ ...previous, icon }));
      const targetIcon = await readAsset(bank.id, format === 'txt' ? 'icon-txt' : 'icon-yaml');
      setPreviewIcons(previous => ({ ...previous, [format]: targetIcon }));
      setSaveDialog(false);
      setToast(result.saved ? '保存しました' : result.message || '変更はありません');
      return true;
    } catch (caught) { setSaveDialog(false); setToast(String(caught instanceof Error ? caught.message : caught)); return false; }
    finally { setBusy(false); }
  }

  async function saveAll() {
    if (!bank || !anyDirty || bulkSaving) return;
    setBulkDialog(false);
    setBulkSaving(true);
    bulkSavingRef.current = true;
    try {
      if (dirty && !await save('txt')) throw new Error('character.txtの保存に失敗しました');
      if (yamlDirty && !await save('yaml')) throw new Error('character.yamlの保存に失敗しました');
      for (const [label, pending, handle] of [
        ['readme.txt', readmeDirty, readmeRef.current],
        ['アイコン・立ち絵', imagesDirty, imagesRef.current],
        ['prifixmap', pitchDirty, pitchRef.current],
        ['VoiceColor', colorsDirty, colorsRef.current],
        ['Phonemizer', phonemizerDirty, phonemizerRef.current]
      ] as const) {
        if (pending && (!handle || !await handle.savePending())) throw new Error(`${label}の保存に失敗しました`);
      }
      setToast('未保存の変更をすべて保存しました');
      playNotificationSound('save');
    } catch (caught) { setToast(String(caught instanceof Error ? caught.message : caught)); }
    finally { bulkSavingRef.current = false; setBulkSaving(false); }
  }

  const activeDraft = basicFormat === 'txt' ? draft : yamlDraft;
  const activeBaseline = basicFormat === 'txt' ? baseline : yamlBaseline;
  const activeChanges = basicFormat === 'txt' ? changes : yamlChanges;
  const activeDirty = basicFormat === 'txt' ? dirty : yamlDirty;
  const activeWritable = basicFormat === 'txt' ? bank?.writable : bank?.yaml.writable;
  const selectedPlugin = plugins.find(plugin => pluginPage(plugin.id) === page);
  const pageLabel = selectedPlugin?.name || pages.find(item => item.id === page)?.label || 'プラグイン管理';

  if (mode === 'start') return <div className="new-shell"><header className="new-top"><div className="new-brand"><span className="new-logo"><img src={appIcon} alt="" /></span><strong>ふっきんちゃんが<br />一晩でやってくれました</strong></div><button className="icon-button" aria-label="テーマ切替" onClick={() => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')}>{theme === 'dark' ? '☼' : '☾'}</button></header><main className="new-main"><h1>音源を選択</h1><div className="start-options"><button onClick={() => setMode('existing')}><strong>既存音源を開く</strong><span>今ある音源の設定を確認・編集</span></button><button onClick={() => setMode('new')}><strong>新規音源を作成</strong><span>録音ファイルから音源フォルダを構築</span></button></div></main>{toast && <div className="toast show" role="status">{toast}</div>}{dragging && <div className="drop-overlay"><strong>音源フォルダをドロップ</strong></div>}</div>;
  if (mode === 'new') return <NewVoicebank onBack={() => setMode('start')} onCreated={async path => { await load(path); setMode('existing'); setPage('overview'); }}/>;

  return <div className={`app ${dragging ? 'dragging' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><img src={appIcon} alt="" /></div><div><strong>ふっきんちゃんが<br />一晩でやってくれました</strong></div></div><button className="nav-item" onClick={() => { if (anyDirty && !window.confirm('未保存の変更を破棄して開始画面に戻りますか？')) return; setMode('start'); }}><span className="nav-icon">←</span><span>音源を選ぶ</span></button>
      <nav aria-label="メインナビゲーション">
        {pages.filter(item => item.id !== 'settings').map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></button>)}
        {plugins.map(plugin => <button key={plugin.id} className={`nav-item plugin-nav-item ${page === pluginPage(plugin.id) ? 'active' : ''}`} onClick={() => setPage(pluginPage(plugin.id))} title={plugin.name}><span className="nav-icon plugin-nav-icon">{pluginTabIcon}</span><span>{plugin.name}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="side-separator"/><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><span className="nav-icon">⚙</span><span>アプリ設定</span></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span className="topbar-bank-icon">{assetPreviews.icon ? <img src={assetPreviews.icon} alt=""/> : '♪'}</span><span>{bank ? bank.character.name || bank.name : '音源未選択'}</span><span className="slash">/</span><strong>{pageLabel}</strong></div><div className="top-actions"><span className={`status-pill ${anyDirty ? 'dirty' : ''}`}><i/>{anyDirty ? '未保存の変更' : '変更なし'}</span><button className="secondary-button save-all-button" disabled={!bank || !anyDirty || busy || bulkSaving} onClick={() => setBulkDialog(true)}>{bulkSaving ? '保存中…' : 'まとめて保存'}</button><button className="icon-button" aria-label="テーマ切替" title="テーマ切替" onClick={() => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')}>{theme === 'dark' ? '☼' : '☾'}</button><button className="top-open" onClick={chooseFolder}>＋ 音源を開く</button></div></header>
      <main className="content">
        {page === 'overview' && <section className="page active"><div className="page-heading"><h1>概要</h1></div><div className="hero-card"><div className="hero-overline">音源</div><div className="hero-content"><div className="voice-avatar">{assetPreviews.icon ? <img src={assetPreviews.icon} alt="音源アイコン"/> : '♪'}</div><div className="voice-details"><h2>{bank?.character.name || bank?.name || '音源を選択してください'}</h2><p>{bank?.root || '音源フォルダをここへドラッグ＆ドロップ'}</p></div><button className="hero-button" onClick={chooseFolder}>フォルダを開く</button></div><div className="hero-bottom"><span><i className="hero-point"/>{bank ? bank.exists ? 'character.txt を検出' : 'character.txt は未作成' : 'フォルダをドロップできます'}</span><button className="overview-preview-button" disabled={!bank} onClick={() => setSingerPreviewOpen(true)}>音源表示を確認</button><span>{bank?.encoding || '文字コード —'}</span></div></div><div className="section-title"><h3>ファイル</h3></div><div className="stats-grid">{([['wav','音声ファイル','◖'],['oto','原音設定','▤'],['frq','FRQ','≋'],['folders','サブフォルダ','▦']] as const).map(([key,label,icon]) => <div className="stat-card" key={key}><div className="stat-icon">{icon}</div><span>{label}</span><strong>{bank ? bank.counts[key].toLocaleString() : '—'}</strong></div>)}</div></section>}
        {page === 'basic' && <section className="page active"><div className="subpage-head"><h1>基本情報</h1></div><div className="editor-layout"><div className="panel editor-panel"><div className="basic-tabs"><button className={basicFormat === 'txt' ? 'active' : ''} onClick={() => setBasicFormat('txt')}>character.txt</button><button className={basicFormat === 'yaml' ? 'active' : ''} onClick={() => setBasicFormat('yaml')}>character.yaml</button><span/><button onClick={() => { setYamlDraft({ ...draft }); setBasicFormat('yaml'); setToast('TXTの内容をYAMLへコピーしました'); }} disabled={!bank}>TXT → YAML</button><button onClick={() => { setDraft({ ...yamlDraft }); setBasicFormat('txt'); setToast('YAMLの内容をTXTへコピーしました'); }} disabled={!bank}>YAML → TXT</button></div><div className="panel-heading"><div><h3>{basicFormat === 'txt' ? 'character.txt' : 'character.yaml'}</h3><p>{bank?.root || '音源を開くと編集できます'}</p></div><span className="file-badge">{basicFormat === 'txt' ? 'TXT' : 'YAML'}</span></div><div className="form-grid" key={basicFormat}>{fieldLabels.map((field,index) => <label className={`field ${index === 0 || index === 5 ? 'full' : ''}`} key={field.key}><span>{field.label}</span><input value={activeDraft[field.key]} disabled={!activeWritable} placeholder={field.placeholder} onChange={event => basicFormat === 'txt' ? setDraft({ ...draft, [field.key]: event.target.value }) : setYamlDraft({ ...yamlDraft, [field.key]: event.target.value })}/></label>)}</div><div className="editor-actions"><span>{bank && !activeWritable ? 'このファイルは編集できません' : activeDirty ? '未保存の変更があります' : bank ? '変更はありません' : '音源フォルダを開いてください'}</span><button className="primary-button" disabled={!activeWritable || !activeDirty} onClick={() => setSaveDialog(true)}>変更を確認して保存 →</button></div>{basicFormat === 'yaml' && bank?.yaml.warnings.length ? <div className="pitch-warning">{bank.yaml.warnings.join(' / ')}</div> : null}</div><div className="inspector"><div className="panel info-panel"><h3>ファイル情報</h3><div className="info-row"><span>ファイル</span><strong>{bank ? (basicFormat === 'txt' ? bank.exists : bank.yaml.exists) ? '読み込み済み' : '未作成' : '未選択'}</strong></div><div className="info-row"><span>文字コード</span><strong>{bank ? basicFormat === 'txt' ? bank.encoding : 'UTF-8' : '—'}</strong></div><div className="info-row"><span>保存方法</span><strong>上書き保存</strong></div><div className="basic-assets"><div className="basic-asset icon">{assetPreviews.icon ? <img src={assetPreviews.icon} alt="アイコン"/> : 'アイコン'}</div><div className="basic-asset portrait">{assetPreviews.portrait ? <img src={assetPreviews.portrait} alt="立ち絵"/> : '立ち絵'}</div></div></div></div></div></section>}
        <div className={page === 'basic' ? 'view-slot active' : 'view-slot'} style={{ display: page === 'basic' ? undefined : 'none' }}><Readme ref={readmeRef} bank={bank} onCreated={() => setBank(previous => previous ? { ...previous, readmeExists: true } : previous)} onTextChange={setReadmeText} onDirtyChange={setReadmeDirty} onPreview={() => setSingerPreviewOpen(true)} notify={setToast}/></div>
        <div className={page === 'images' ? 'view-slot active' : 'view-slot'} style={{ display: page === 'images' ? undefined : 'none' }}><Images ref={imagesRef} bankId={bank?.id || null} portraitSettings={bank?.portraitSettings || { height: 0, opacity: 0 }} notify={setToast} onChanged={assetChanged} onPortraitSettingsChanged={portraitSettingsChanged} onDirtyChange={setImagesDirty} onPreviewIcon={() => setSingerPreviewOpen(true)}/></div>
        <div className={page === 'pitch' ? 'view-slot active' : 'view-slot'} style={{ display: page === 'pitch' ? undefined : 'none' }}><PitchMap ref={pitchRef} bankId={bank?.id || null} notify={setToast} onDirtyChange={setPitchDirty}/></div>
        <div className={page === 'phonemizer' ? 'view-slot active' : 'view-slot'} style={{ display: page === 'phonemizer' ? undefined : 'none' }}><Phonemizer ref={phonemizerRef} bankId={bank?.id || null} notify={setToast} onDirtyChange={setPhonemizerDirty}/></div>
        <div className={page === 'colors' ? 'view-slot active' : 'view-slot'} style={{ display: page === 'colors' ? undefined : 'none' }}><VoiceColors ref={colorsRef} bankId={bank?.id || null} notify={setToast} onDirtyChange={setColorsDirty}/></div>
        {page === 'frequency' && <div className="view-slot active"><Frequency bankId={bank?.id || null} notify={setToast}/></div>}
        {page === 'cleanup' && <div className="view-slot active"><FileTree bankId={bank?.id || null} notify={setToast}/></div>}
        {(page === 'plugins' || selectedPlugin) && <Plugins key={page} bankId={bank?.id || null} hasUnsavedChanges={anyDirty} items={plugins} pluginId={selectedPlugin?.id || null} onItemsChanged={setPlugins} onOpen={id => setPage(pluginPage(id))} notify={setToast} onWritten={async () => { if (bank) await load(bank.root); }}/>}
        {page === 'settings' && <section className="page active">
          <div className="subpage-head"><h1>アプリ設定</h1></div>
          <div className="panel settings-card"><h3>表示テーマ</h3><div className="theme-options">{(['system','light','dark'] as const).map(value => <button key={value} className={theme === value ? 'selected' : ''} onClick={() => setTheme(value)}>{value === 'system' ? 'システム' : value === 'light' ? 'ライト' : 'ダーク'}</button>)}</div></div>
          <div className="panel settings-card build-info-card"><h3>バージョン・ビルド情報</h3>
            <div className="info-row"><span>バージョン</span><strong>{appInfo?.version || '—'}</strong></div>
            <div className="info-row"><span>ビルド形式</span><strong>{appInfo ? appInfo.packaged ? '配布版' : '開発版' : '—'}</strong></div>
            <div className="info-row"><span>動作環境</span><strong>{appInfo ? `${appInfo.platform === 'win32' ? 'Windows' : appInfo.platform === 'darwin' ? 'macOS' : appInfo.platform} · ${appInfo.arch}` : '—'}</strong></div>
            <div className="info-row"><span>CPU</span><strong>{appInfo?.cpu || '—'}</strong></div>
            <div className="info-row"><span>Electron</span><strong>{appInfo?.electron || '—'}</strong></div>
            <div className="info-row"><span>プラグインAPI</span><strong>{appInfo?.pluginApiVersion ?? '—'}</strong></div>
          </div>
          <div className="panel settings-card build-info-card"><h3>クレジット</h3>
            <div className="info-row"><span>お知らせボイス</span><strong>COEROINK:ふっきんちゃん -しおしお-</strong></div>
          </div>
        </section>}
      </main>
    </div>
    {saveDialog && <div className="modal-backdrop"><div className="modal"><h2>{basicFormat === 'txt' ? 'character.txt' : 'character.yaml'} の変更</h2><div className="changes-list">{Object.entries(activeChanges).map(([key,value]) => <div className="change-row" key={key}><strong>{fieldLabels.find(item => item.key === key)?.label}</strong><span>{activeBaseline[key as FieldKey] || '（空欄）'} → {value || '（空欄）'}</span></div>)}</div><p className="dialog-note">変更を保存します。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setSaveDialog(false)}>戻る</button><button className="primary-button" disabled={busy} onClick={() => { void save(); }}>保存する</button></div></div></div>}
    {bulkDialog && <div className="modal-backdrop"><div className="modal"><h2>未保存の変更をまとめて保存</h2><div className="changes-list">{([['character.txt', dirty], ['character.yaml', yamlDirty], ['readme.txt', readmeDirty], ['アイコン・立ち絵', imagesDirty], ['prifixmap', pitchDirty], ['VoiceColor', colorsDirty], ['Phonemizer', phonemizerDirty]] as const).filter(([, pending]) => pending).map(([label]) => <div className="change-row" key={label}><strong>{label}</strong></div>)}</div><p className="dialog-note">変更したファイルを順に保存します。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setBulkDialog(false)}>戻る</button><button className="primary-button" onClick={() => { void saveAll(); }}>まとめて保存</button></div></div></div>}
    {singerPreviewOpen && bank && <SingerPreview bank={bank} txt={draft} yaml={yamlDraft} icons={previewIcons} readme={readmeText} onClose={() => setSingerPreviewOpen(false)}/>}
    {toast && <div className="toast show" role="status">{toast}</div>}
    {showWorking && <div className="working-indicator" role="status"><span className="working-spinner"/>処理中</div>}
    {dragging && <div className="drop-overlay"><strong>音源フォルダをドロップ</strong></div>}
  </div>;
}
