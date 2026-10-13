import { useEffect, useState } from 'react';
import { analyzeNewSources, createNewVoicebank, getDroppedPath, pickNewDestination, playNotification, type NewVoicebankAnalysis } from './voicebank';
import './new-voicebank.css';
import appIcon from '../assets/icon.png';

export default function NewVoicebank({ onBack, onCreated }: { onBack: () => void; onCreated: (path: string) => Promise<void> }) {
  const [analysis, setAnalysis] = useState<NewVoicebankAnalysis | null>(null);
  const [destination, setDestination] = useState<{ token: string; path: string } | null>(null);
  const [name, setName] = useState('');
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  async function handleDrop(paths: string[]) {
    if (!paths.length) { playNotification('error'); setError('録音ファイルまたは収録フォルダをドロップしてください'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await analyzeNewSources(paths);
      setAnalysis(result);
      setMulti(result.multi);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const onDrag = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event) && !event.dataTransfer?.files.length) return;
      event.preventDefault();
      setDragging(false);
      const paths = Array.from(event.dataTransfer?.files || []).map(getDroppedPath).filter(Boolean);
      void handleDrop(paths);
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
  }, []);

  async function selectDestination() {
    setBusy(true);
    try { const result = await pickNewDestination(); if (result) setDestination(result); }
    catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!analysis || !destination || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await createNewVoicebank(analysis.token, destination.token, name.trim(), multi);
      await onCreated(result.path);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setBusy(false); }
  }

  return <div className="new-shell"><header className="new-top"><div className="new-brand"><span className="new-logo"><img src={appIcon} alt="" /></span><strong>ふっきんちゃんが<br />一晩でやってくれました</strong><span className="new-slash">/</span><span>新規音源</span></div><button className="secondary-button" onClick={onBack}>戻る</button></header><main className="new-main"><h1>新規音源を作成</h1><div className="new-grid"><section className="panel new-panel"><h2>録音ファイル</h2><div className={`new-drop ${dragging ? 'dragging' : ''}`}><strong>{analysis ? `${analysis.wavCount} WAV を読み込み` : 'WAV または収録フォルダをドロップ'}</strong><span>複数のファイル・フォルダをまとめて指定できます</span></div>{analysis && <><div className="new-info"><span>自動判定</span><strong>{analysis.multi ? '多音階' : '単音階'}</strong><small>{analysis.reason}</small></div><div className="new-choice" role="group" aria-label="音階構成"><button className={!multi ? 'selected' : ''} onClick={() => setMulti(false)}>単音階</button><button className={multi ? 'selected' : ''} onClick={() => setMulti(true)}>多音階</button></div><p className="new-muted">character.txt：{analysis.hasCharacter ? '取り込み元から読み込み' : '新規作成'} · readme.txt：{analysis.hasReadme ? '取り込み元から読み込み' : '新規作成'}{analysis.folders.length ? ` · 収録フォルダ ${analysis.folders.length}` : ''}</p></>}</section><section className="panel new-panel"><h2>保存先</h2><label className="new-field"><span>音源名・フォルダ名</span><input value={name} onChange={event => setName(event.target.value)} placeholder="音源名" maxLength={120}/></label><div className="new-destination"><button className="secondary-button" onClick={selectDestination} disabled={busy}>保存先を選択</button><span title={destination?.path}>{destination?.path || '未選択'}</span></div><div className="new-summary">{destination && name.trim() ? <span>作成先：{destination.path} / {name.trim()}</span> : <span>保存先に新しい音源フォルダを作ります</span>}</div><button className="primary-button new-create" disabled={!analysis || !destination || !name.trim() || busy} onClick={create}>{busy ? '処理中…' : '音源を作成'}</button></section></div>{error && <div className="new-error" role="alert">{error}</div>}</main>{busy && <div className="working-indicator" role="status"><span className="working-spinner"/>処理中</div>}</div>;
}
