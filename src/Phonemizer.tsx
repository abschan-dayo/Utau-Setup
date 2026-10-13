import { useEffect, useImperativeHandle, useState, type Ref } from 'react';
import { readPhonemizer, savePhonemizer, type PhonemizerSetting, type SavePendingHandle } from './voicebank';

const choices = [
  { label: '指定なし', value: '' },
  { label: 'UTAU Classic（歌詞をそのままエイリアスにする）', value: 'OpenUtau.Core.DefaultPhonemizer' },
  { label: '日本語 VCV & CVVC（JA Presamp）', value: 'OpenUtau.Plugin.Builtin.JapanesePresampPhonemizer' },
  { label: '日本語 VCV（連続音）', value: 'OpenUtau.Plugin.Builtin.JapaneseVCVPhonemizer' },
  { label: '日本語 CVVC', value: 'OpenUtau.Plugin.Builtin.JapaneseCVVCPhonemizer' }
];

export default function Phonemizer({ bankId, notify, onDirtyChange, ref }: { bankId: string | null; notify(message: string): void; onDirtyChange(dirty: boolean): void; ref?: Ref<SavePendingHandle> }) {
  const [setting, setSetting] = useState<PhonemizerSetting | null>(null);
  const [value, setValue] = useState('');
  const [baseline, setBaseline] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState(false);
  const dirty = value !== baseline;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    let live = true;
    setSetting(null);
    setValue('');
    setBaseline('');
    setError('');
    if (!bankId) return;
    void readPhonemizer(bankId).then(result => {
      if (!live) return;
      setSetting(result);
      setValue(result.value);
      setBaseline(result.value);
      setCustom(Boolean(result.value) && !choices.some(choice => choice.value === result.value));
    }).catch(caught => { if (live) setError(String(caught instanceof Error ? caught.message : caught)); });
    return () => { live = false; };
  }, [bankId]);

  async function save() {
    if (!bankId) return false;
    setBusy(true);
    setError('');
    try {
      const result = await savePhonemizer(bankId, value);
      setBaseline(result.value ?? value.trim());
      setValue(result.value ?? value.trim());
      setSetting(previous => previous ? { ...previous, exists: true, value: result.value ?? value.trim() } : previous);
      setConfirm(false);
      notify(result.saved ? 'character.yamlを保存しました' : result.message || '変更はありません');
      return true;
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); setConfirm(false); return false; }
    finally { setBusy(false); }
  }
  useImperativeHandle(ref, () => ({ savePending: () => dirty && setting?.writable ? save() : Promise.resolve(!dirty) }));

  return <section className="page active"><div className="subpage-head"><h1>Phonemizer</h1></div>
    {!bankId ? <div className="panel pitch-empty">音源を開いてください</div> : <div className="panel phonemizer-panel"><div className="panel-heading"><div><h3>デフォルトPhonemizer</h3><p>{setting ? `${setting.exists ? 'character.yaml を読み込み済み' : 'character.yaml は未作成'}` : '読み込み中'}</p></div><span className="file-badge">YAML</span></div><label className="field phonemizer-field"><span>種類</span><select value={custom ? '__custom' : value} disabled={!setting?.writable} onChange={event => { if (event.target.value === '__custom') { setCustom(true); setValue(''); } else { setCustom(false); setValue(event.target.value); } }}>{choices.map(choice => <option value={choice.value} key={choice.value}>{choice.label}</option>)}<option value="__custom">その他（クラス名を入力）</option></select></label>{!custom && value === 'OpenUtau.Core.DefaultPhonemizer' && <p className="phonemizer-help">Classic UTAU方式で、ノートの歌詞をoto.iniのエイリアスへそのまま割り当てます。</p>}{custom && <label className="field phonemizer-custom"><span>クラスの完全修飾名</span><input value={value} disabled={!setting?.writable} onChange={event => setValue(event.target.value)} placeholder="OpenUtau.Plugin..."/></label>}<div className="phonemizer-actions"><span>{dirty ? '未保存の変更があります' : '変更なし'}</span><button className="primary-button" disabled={!setting?.writable || !dirty || busy || (custom && !value.trim())} onClick={() => setConfirm(true)}>変更を確認して保存</button></div>{setting?.warnings.length ? <div className="pitch-warning">{setting.warnings.join(' / ')}</div> : null}{error && <div className="pitch-error" role="alert">{error}</div>}</div>}
    {confirm && <div className="modal-backdrop"><div className="modal"><h2>Phonemizerの変更</h2><div className="changes-list"><div className="change-row"><strong>default_phonemizer</strong><span>{baseline || '（指定なし）'} → {value || '（指定なし）'}</span></div></div><p className="dialog-note">character.yamlを更新します。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(false)}>戻る</button><button className="primary-button" disabled={busy} onClick={save}>保存する</button></div></div></div>}
  </section>;
}
