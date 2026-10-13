import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { createReadme, readReadme, saveReadme, type SavePendingHandle, type Voicebank } from './voicebank';
import './readme.css';

export default function Readme({ bank, onCreated, onTextChange, onDirtyChange, onPreview, notify, ref }: { bank: Voicebank | null; onCreated(): void; onTextChange(text: string): void; onDirtyChange(dirty: boolean): void; onPreview(): void; notify(message: string): void; ref?: Ref<SavePendingHandle> }) {
  const [baseline, setBaseline] = useState('');
  const [draft, setDraft] = useState('');
  const [exists, setExists] = useState(false);
  const [encoding, setEncoding] = useState('ANSI (CP932)');
  const [writable, setWritable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = draft !== baseline;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    let live = true;
    setBaseline(''); setDraft(''); setExists(false); setError(''); onTextChange('');
    if (bank) void readReadme(bank.id).then(result => {
      if (!live) return;
      setBaseline(result.text); setDraft(result.text); setExists(result.exists);
      setEncoding(result.encoding); setWritable(result.writable); onTextChange(result.text);
    }).catch(caught => { if (live) setError(String(caught instanceof Error ? caught.message : caught)); });
    return () => { live = false; };
  }, [bank?.id]);

  async function generate() {
    if (!bank) return;
    setBusy(true); setError('');
    try {
      const result = await createReadme(bank.id);
      const file = await readReadme(bank.id);
      setBaseline(file.text); setDraft(file.text); setExists(file.exists);
      setEncoding(file.encoding); setWritable(file.writable); onTextChange(file.text);
      onCreated();
      notify(result.created ? 'readme.txtを生成しました' : 'readme.txtは既にあります');
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { setBusy(false); }
  }

  async function save(): Promise<boolean> {
    if (!bank || !dirty || !writable) return !dirty;
    setBusy(true); setError('');
    try {
      const result = await saveReadme(bank.id, draft);
      setBaseline(draft); setExists(true); onCreated();
      notify(result.saved ? 'readme.txtを保存しました' : result.message || '変更はありません');
      return true;
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); return false; }
    finally { setBusy(false); }
  }

  useImperativeHandle(ref, () => ({ savePending: save }));

  return <section className="panel readme-panel"><div className="readme-heading"><div><h2>readme.txt</h2><p>{exists ? encoding : '未作成 · ANSI (CP932)'}</p></div><div className="readme-actions"><button className="secondary-button" disabled={!bank} onClick={onPreview}>表示を確認</button><button className="secondary-button" disabled={!bank || exists || busy} onClick={generate}>新規作成</button><button className="primary-button" disabled={!bank || !exists || !dirty || !writable || busy} onClick={() => { void save(); }}>保存</button></div></div>{exists && <textarea aria-label="readme.txtを編集" value={draft} disabled={!writable || busy} onChange={event => { setDraft(event.target.value); onTextChange(event.target.value); }} spellCheck={false}/>} {!writable && <p className="readme-error">元の文字コードを安全に再現できないため編集できません</p>}{error && <p className="readme-error" role="alert">{error}</p>}</section>;
}
