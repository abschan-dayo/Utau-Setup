import { useEffect, useMemo, useState } from 'react';
import { deleteFrequencyFile, deleteFrequencyFilesByExtension, generateFrqs, generateLlsms, onFrqProgress, onLlsmProgress, pickMoresampler, readFrequencyFiles, type FrequencyFile, type FrqGenerationProgress, type PickedMoresampler } from './voicebank';
import './frequency.css';

const kinds = [
  { extension: '.frq', label: 'FRQ' },
  { extension: '.llsm', label: 'LLSM' },
  { extension: '.pmk', label: 'PMK' }
] as const;

export default function Frequency({ bankId, notify }: { bankId: string | null; notify(message: string): void }) {
  const [files, setFiles] = useState<FrequencyFile[]>([]);
  const [selected, setSelected] = useState<FrequencyFile['extension']>('.frq');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<FrqGenerationProgress | null>(null);
  const [generationNote, setGenerationNote] = useState('');
  const [llsmGenerating, setLlsmGenerating] = useState(false);
  const [llsmProgress, setLlsmProgress] = useState<FrqGenerationProgress | null>(null);
  const [llsmNote, setLlsmNote] = useState('');
  const [moresampler, setMoresampler] = useState<PickedMoresampler | null>(null);

  useEffect(() => onFrqProgress(next => { if (next.id === bankId) setProgress(next); }), [bankId]);
  useEffect(() => onLlsmProgress(next => { if (next.id === bankId) setLlsmProgress(next); }), [bankId]);

  useEffect(() => {
    let live = true;
    setFiles([]);
    setError('');
    setGenerationNote('');
    setLlsmNote('');
    setProgress(null);
    setLlsmProgress(null);
    setPage(0);
    if (!bankId) return;
    setLoading(true);
    void readFrequencyFiles(bankId).then(result => {
      if (live) {
        setFiles(result);
        const first = kinds.find(kind => result.some(file => file.extension === kind.extension));
        if (first) setSelected(first.extension);
      }
    }).catch(caught => { if (live) setError(String(caught instanceof Error ? caught.message : caught)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [bankId]);

  const counts = useMemo(() => Object.fromEntries(kinds.map(kind => [kind.extension, files.filter(file => file.extension === kind.extension).length])) as Record<FrequencyFile['extension'], number>, [files]);
  const filtered = useMemo(() => files.filter(file => file.extension === selected), [files, selected]);
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

  async function remove(file: FrequencyFile) {
    if (!bankId) return;
    setBusyPath(file.path);
    setError('');
    try {
      const result = await deleteFrequencyFile(bankId, file.path);
      setFiles(result.files);
      setPage(current => Math.min(current, Math.max(0, Math.ceil((filtered.length - 1) / pageSize) - 1)));
      if (result.deleted) notify(file.extension === '.frq' ? 'FRQファイルを削除しました' : '周波数表ファイルを削除しました');
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setBusyPath(null); }
  }

  async function removeExtension() {
    if (!bankId) return;
    setBusyPath('*');
    setError('');
    try {
      const result = await deleteFrequencyFilesByExtension(bankId, selected);
      setFiles(result.files);
      setPage(0);
      if (result.deleted) notify(`${selected.toUpperCase()}ファイルを${result.deleted}件削除しました`);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setBusyPath(null); }
  }

  async function generate(overwrite: boolean) {
    if (!bankId) return;
    setGenerating(true);
    setProgress(null);
    setError('');
    setGenerationNote('');
    try {
      const result = await generateFrqs(bankId, overwrite);
      if (result.canceled) return;
      setFiles(result.files);
      setSelected('.frq');
      setPage(0);
      setGenerationNote(`${result.generated}件生成 · ${result.skipped}件スキップ · ${result.failed}件失敗`);
      if (result.errors.length) setError(result.errors.join('\n'));
      if (result.generated) notify(`FRQを${result.generated}件生成しました`);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setGenerating(false); setProgress(null); }
  }

  async function chooseMoresampler() {
    setError('');
    try {
      const picked = await pickMoresampler();
      if (picked) setMoresampler(picked);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
  }

  async function generateLlsm(overwrite: boolean) {
    if (!bankId || !moresampler) return;
    setLlsmGenerating(true);
    setLlsmProgress(null);
    setLlsmNote('');
    setError('');
    try {
      const result = await generateLlsms(bankId, moresampler.token, overwrite);
      if (result.canceled) return;
      setFiles(result.files);
      setSelected('.llsm');
      setPage(0);
      setLlsmNote(`${result.generated}件生成 · ${result.skipped}件スキップ · ${result.failed}件失敗`);
      if (result.errors.length) setError(result.errors.join('\n'));
      if (result.generated) notify(`LLSMを${result.generated}件生成しました`);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setLlsmGenerating(false); setLlsmProgress(null); }
  }

  return <section className="page active">
    <div className="subpage-head"><h1>周波数表</h1></div>
    {!bankId ? <div className="panel pitch-empty">音源フォルダを開いてください</div> : <>
      <div className="panel frequency-generate">
        <div><h2>FRQ生成</h2><p>音源内のWAVから一括生成</p></div>
        <div className="frequency-generate-actions">
          <button className="primary-button" disabled={generating || llsmGenerating || busyPath !== null || loading} onClick={() => generate(false)}>未作成のFRQを生成</button>
          <button className="secondary-button" disabled={generating || llsmGenerating || busyPath !== null || loading} onClick={() => generate(true)}>すべて再生成</button>
        </div>
        {generating && <div className="frequency-progress" role="status"><span className="frequency-spinner" />{progress ? `${progress.current} / ${progress.total}件を処理中` : 'WAVを確認中'}</div>}
        {generationNote && <div className="frequency-generation-note" role="status">{generationNote}</div>}
      </div>
      <div className="panel frequency-generate">
        <div><h2>LLSM生成</h2><p>{moresampler ? moresampler.name : 'Moresamplerを選択してください'}</p></div>
        <div className="frequency-generate-actions">
          <button className="secondary-button" disabled={generating || llsmGenerating || busyPath !== null} onClick={chooseMoresampler}>Moresamplerを選択</button>
          <button className="primary-button" disabled={!moresampler || generating || llsmGenerating || busyPath !== null || loading} onClick={() => generateLlsm(false)}>未作成のLLSMを生成</button>
          <button className="secondary-button" disabled={!moresampler || generating || llsmGenerating || busyPath !== null || loading} onClick={() => generateLlsm(true)}>すべて再生成</button>
        </div>
        {llsmGenerating && <div className="frequency-progress" role="status"><span className="frequency-spinner" />{llsmProgress ? `${llsmProgress.current} / ${llsmProgress.total}件を処理中` : 'WAVを確認中'}</div>}
        {llsmNote && <div className="frequency-generation-note" role="status">{llsmNote}</div>}
      </div>
      {loading ? <div className="panel pitch-empty">読み込み中</div> : files.length === 0 ? <div className="panel pitch-empty">周波数表はありません</div> : <div className="panel frequency-manager">
        <div className="frequency-tabs" role="tablist" aria-label="周波数表の種類">
          {kinds.filter(kind => counts[kind.extension] > 0).map(kind => <button key={kind.extension} role="tab" aria-selected={selected === kind.extension} className={selected === kind.extension ? 'active' : ''} onClick={() => { setSelected(kind.extension); setPage(0); }}>{kind.label}<span>{counts[kind.extension]}</span></button>)}
        </div>
        <div className="frequency-list-head"><h2>{selected.toUpperCase()}ファイル</h2><button className="danger-button" disabled={busyPath !== null || generating || llsmGenerating || counts[selected] === 0} onClick={removeExtension}>{busyPath === '*' ? '削除中' : `${selected.toUpperCase()}を一括削除`}</button></div>
        <div className="frequency-files">{visible.map(file => <div className="frequency-file" key={file.path}><span title={file.path}>{file.path}</span><button className="danger-button" disabled={busyPath !== null || generating || llsmGenerating} onClick={() => remove(file)}>{busyPath === file.path ? '削除中' : '削除'}</button></div>)}</div>
        <div className="frequency-list-footer"><span>{filtered.length.toLocaleString()}件 · {(page + 1).toLocaleString()} / {pageCount.toLocaleString()}ページ</span><div><button className="secondary-button" disabled={page === 0} onClick={() => setPage(current => current - 1)}>前へ</button><button className="secondary-button" disabled={page + 1 >= pageCount} onClick={() => setPage(current => current + 1)}>次へ</button></div></div>
      </div>}
      {error && <div className="pitch-error frequency-error" role="alert">{error}</div>}
    </>}
  </section>;
}
