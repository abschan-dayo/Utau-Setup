import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { pickAsset, readAsset, saveAsset, savePortraitSettings, type PickedAsset, type PortraitSettings, type SavePendingHandle } from './voicebank';

type Kind = 'icon' | 'portrait';
type Drafts = Record<Kind, PickedAsset | null>;

export default function Images({ bankId, portraitSettings, notify, onChanged, onPortraitSettingsChanged, onDirtyChange, onPreviewIcon, ref }: { bankId: string | null; portraitSettings: PortraitSettings; notify(message: string): void; onChanged(kind: Kind, dataUrl: string | null, filename?: string, iconTarget?: 'txt' | 'yaml'): void; onPortraitSettingsChanged(settings: PortraitSettings): void; onDirtyChange(dirty: boolean): void; onPreviewIcon(): void; ref?: Ref<SavePendingHandle> }) {
  const [current, setCurrent] = useState<Record<Kind, string | null>>({ icon: null, portrait: null });
  const [drafts, setDrafts] = useState<Drafts>({ icon: null, portrait: null });
  const [busy, setBusy] = useState<Kind | 'settings' | null>(null);
  const [error, setError] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHeight, setPreviewHeight] = useState(portraitSettings.height);
  const [previewOpacity, setPreviewOpacity] = useState(Math.round(portraitSettings.opacity * 100));
  const [naturalHeight, setNaturalHeight] = useState(800);
  const [motionEnabled, setMotionEnabled] = useState(false);
  const [iconTarget, setIconTarget] = useState<'txt' | 'yaml'>('txt');

  const portrait = drafts.portrait?.dataUrl || current.portrait;
  const previewHeightPercent = Math.min(previewHeight || naturalHeight, 800) / 800 * 100;
  const settingsDirty = previewHeight !== portraitSettings.height || previewOpacity !== Math.round(portraitSettings.opacity * 100);
  useEffect(() => onDirtyChange(Boolean(drafts.icon || drafts.portrait || settingsDirty)), [drafts, settingsDirty, onDirtyChange]);

  useEffect(() => {
    if (!previewOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewOpen]);

  useEffect(() => {
    let live = true;
    setDrafts({ icon: null, portrait: null });
    setCurrent({ icon: null, portrait: null });
    setPreviewHeight(portraitSettings.height);
    setPreviewOpacity(Math.round(portraitSettings.opacity * 100));
    setNaturalHeight(800);
    setPreviewOpen(false);
    if (!bankId) return;
    void Promise.all([readAsset(bankId, 'icon'), readAsset(bankId, 'portrait')]).then(([icon, portrait]) => {
      if (!live) return;
      setCurrent({ icon, portrait });
      onChanged('icon', icon);
      onChanged('portrait', portrait);
    }).catch(caught => { if (live) setError(String(caught instanceof Error ? caught.message : caught)); });
    return () => { live = false; };
  }, [bankId]);

  async function choose(kind: Kind) {
    if (!bankId) return;
    setError('');
    try {
      const selected = await pickAsset(bankId);
      if (selected) {
        setDrafts(previous => ({ ...previous, [kind]: selected }));
        if (kind === 'icon') onChanged('icon', selected.dataUrl, undefined, iconTarget);
      }
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
  }

  async function save(kind: Kind) {
    const draft = drafts[kind];
    if (!bankId || !draft) return false;
    setBusy(kind);
    setError('');
    try {
      const result = await saveAsset(bankId, kind, draft.token, kind === 'icon' ? iconTarget : undefined);
      setCurrent(previous => ({ ...previous, [kind]: draft.dataUrl }));
      setDrafts(previous => ({ ...previous, [kind]: null }));
      onChanged(kind, draft.dataUrl, result.filename, kind === 'icon' ? iconTarget : undefined);
      notify(`${kind === 'icon' ? 'アイコン' : '立ち絵'}を保存しました`);
      return true;
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); return false; }
    finally { setBusy(null); }
  }

  async function saveDisplaySettings() {
    if (!bankId) return false;
    setBusy('settings');
    setError('');
    try {
      const result = await savePortraitSettings(bankId, { height: previewHeight, opacity: previewOpacity / 100 });
      onPortraitSettingsChanged(result.settings);
      notify(result.saved ? '立ち絵の表示設定を保存しました' : result.message || '変更はありません');
      return true;
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); return false; }
    finally { setBusy(null); }
  }

  useImperativeHandle(ref, () => ({ savePending: async () => {
    if (drafts.icon && !await save('icon')) return false;
    if (drafts.portrait && !await save('portrait')) return false;
    if (settingsDirty && !await saveDisplaySettings()) return false;
    return true;
  } }));

  const card = (kind: Kind, title: string, note: string) => {
    const selected = drafts[kind];
    const preview = selected?.dataUrl || current[kind];
    return <div className={`panel asset-card ${kind}`}><div className="panel-heading"><div><h3>{title}</h3><p>{note}</p></div><span className="file-badge">{kind === 'icon' ? 'ICON' : 'PORTRAIT'}</span></div>{kind === 'icon' && <label className="field icon-format-field"><span>設定先</span><select value={iconTarget} onChange={event => setIconTarget(event.target.value as 'txt' | 'yaml')}><option value="txt">character.txt（100×100 BMPへ変換）</option><option value="yaml">character.yaml（画像形式を保持）</option></select></label>}<div className="asset-preview">{preview ? <img src={preview} alt={`${title}プレビュー`}/> : <span>画像なし</span>}</div><div className="asset-meta">{selected ? selected.name : current[kind] ? '設定済み' : '未設定'}</div><div className="asset-actions">{kind === 'portrait' ? <button className="secondary-button" disabled={!preview} onClick={() => setPreviewOpen(true)}>表示を確認</button> : <button className="secondary-button" onClick={onPreviewIcon}>表示を確認</button>}<button className="secondary-button" disabled={!bankId || busy !== null} onClick={() => choose(kind)}>画像を選択</button><button className="primary-button" disabled={!selected || busy !== null} onClick={() => save(kind)}>保存</button></div></div>;
  };

  return <section className="page active"><div className="subpage-head"><h1>アイコン・立ち絵</h1></div>{!bankId ? <div className="panel pitch-empty">音源フォルダを開いてください</div> : <><div className="asset-grid">{card('icon', 'アイコン', 'character.txt / character.yaml')}{card('portrait', '立ち絵', 'character.yaml')}</div>{error && <div className="pitch-error" role="alert">{error}</div>}</>}{previewOpen && portrait && <div className="portrait-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setPreviewOpen(false); }}><section className="portrait-preview-dialog" role="dialog" aria-modal="true" aria-label="立ち絵表示確認"><header className="portrait-preview-header"><h2>立ち絵表示確認</h2><button className="secondary-button" onClick={() => setPreviewOpen(false)}>閉じる</button></header><div className="portrait-preview-stage"><div className="portrait-preview-keys" aria-hidden="true"/><div className="portrait-preview-roll"><img className={`portrait-preview-overlay ${motionEnabled ? 'is-animated' : ''}`} src={portrait} alt="立ち絵" onLoad={event => setNaturalHeight(event.currentTarget.naturalHeight || 800)} style={{ height: `${previewHeightPercent}%`, opacity: previewOpacity / 100 }}/></div><div className="portrait-preview-lanes" aria-hidden="true"><span/><span/><span/><span/></div></div><div className="portrait-preview-controls"><label>高さ（0=自動） <input type="range" min="0" max="800" step="10" value={previewHeight} onChange={event => setPreviewHeight(Number(event.target.value))}/><output>{previewHeight === 0 ? '自動' : `${previewHeight}px`}</output></label><label>透明度 <input type="range" min="0" max="100" value={previewOpacity} onChange={event => setPreviewOpacity(Number(event.target.value))}/><output>{previewOpacity}%</output></label></div><footer className="portrait-preview-footer"><button className="secondary-button" aria-pressed={motionEnabled} onClick={() => setMotionEnabled(previous => !previous)}>{motionEnabled ? '動きを停止' : '動きを再生'}</button><span>位置はOpenUtauに合わせています。</span><button className="primary-button" disabled={busy !== null} onClick={saveDisplaySettings}>表示設定を保存</button></footer></section></div>}</section>;
}
