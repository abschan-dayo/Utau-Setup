import { useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { readVoiceColors, saveVoiceColors, type SavePendingHandle, type VoiceColors as VoiceColorsData, type VoiceColorRow } from './voicebank';

const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteToMidi(note: string) {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!match) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase() as 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'];
  return (Number(match[3]) + 1) * 12 + base + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
}
function fromMidi(midi: number) { return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`; }
function includesNote(row: VoiceColorRow, midi: number) {
  return row.toneRanges.some(range => {
    const match = /^([A-Ga-g][#b]?-?\d)(?:-([A-Ga-g][#b]?-?\d))?$/.exec(range);
    if (!match) return false;
    const low = noteToMidi(match[1]);
    const high = noteToMidi(match[2] || match[1]);
    return low !== null && high !== null && midi >= low && midi <= high;
  });
}

export default function VoiceColors({ bankId, notify, onDirtyChange, ref }: { bankId: string | null; notify(message: string): void; onDirtyChange(dirty: boolean): void; ref?: Ref<SavePendingHandle> }) {
  const [data, setData] = useState<VoiceColorsData | null>(null);
  const [draftRows, setDraftRows] = useState<VoiceColorRow[]>([]);
  const [baseline, setBaseline] = useState<VoiceColorRow[]>([]);
  const [color, setColor] = useState('');
  const [extraColors, setExtraColors] = useState<string[]>([]);
  const [newColor, setNewColor] = useState('');
  const [selected, setSelected] = useState<number[]>([60]);
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastSelected = useRef(60);
  const [error, setError] = useState('');
  const dirty = useMemo(() => JSON.stringify(draftRows) !== JSON.stringify(baseline), [draftRows, baseline]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    let live = true;
    setData(null);
    setDraftRows([]); setBaseline([]); setExtraColors([]); setSelected([60]); lastSelected.current = 60;
    setError('');
    setColor('');
    if (bankId) void readVoiceColors(bankId).then(result => { if (live) { setData(result); setDraftRows(result.rows); setBaseline(result.rows); setColor(result.rows[0]?.color || ''); } }).catch(caught => { if (live) setError(String(caught)); });
    return () => { live = false; };
  }, [bankId]);
  const colors = useMemo(() => [...new Set([...draftRows.map(row => row.color), ...extraColors])], [draftRows, extraColors]);
  const rows = useMemo(() => draftRows.filter(row => row.color === color), [draftRows, color]);
  const notes = useMemo(() => Array.from({ length: 84 }, (_, index) => 107 - index), []);
  function selectNote(midi: number, event: MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey) {
      const low = Math.min(lastSelected.current, midi);
      setSelected(Array.from({ length: Math.abs(lastSelected.current - midi) + 1 }, (_, index) => low + index));
    } else if (event.ctrlKey || event.metaKey) {
      setSelected(previous => previous.includes(midi) ? previous.filter(value => value !== midi) : [...previous, midi]);
      lastSelected.current = midi;
    } else { setSelected([midi]); lastSelected.current = midi; }
    const row = rows.find(item => includesNote(item, midi));
    setPrefix(row?.prefix || ''); setSuffix(row?.suffix || '');
  }
  function selectAll() {
    setSelected([...notes]);
    lastSelected.current = notes[0];
  }
  function handleNoteListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAll();
    }
  }
  function apply() {
    if (!selected.length) return;
    const values = Array.from({ length: 128 }, (_, midi) => {
      const existing = rows.find(item => includesNote(item, midi));
      return existing ? { prefix: existing.prefix, suffix: existing.suffix } : null;
    });
    for (const midi of selected) values[midi] = { prefix, suffix };
    const next: VoiceColorRow[] = [];
    for (let midi = 0; midi < values.length; midi++) {
      const value = values[midi];
      if (!value) continue;
      let high = midi;
      while (high + 1 < values.length && values[high + 1]?.prefix === value.prefix && values[high + 1]?.suffix === value.suffix) high++;
      next.push({ color, prefix: value.prefix, suffix: value.suffix, toneRanges: [`${fromMidi(midi)}-${fromMidi(high)}`] });
      midi = high;
    }
    setDraftRows(previous => [...previous.filter(row => row.color !== color), ...next]);
    notify(`${selected.length}音にVoiceColorを設定しました`);
  }
  async function save() {
    if (!bankId) return false;
    setBusy(true); setError('');
    try {
      const result = await saveVoiceColors(bankId, draftRows);
      setBaseline(result.rows); setDraftRows(result.rows); setConfirm(false);
      notify(result.saved ? 'character.yamlを保存しました' : result.message || '変更はありません');
      return true;
    } catch (caught) { setError(String(caught)); setConfirm(false); return false; }
    finally { setBusy(false); }
  }
  useImperativeHandle(ref, () => ({ savePending: () => dirty && data?.writable ? save() : Promise.resolve(!dirty) }));
  return <section className="page active"><div className="subpage-head"><h1>VoiceColor</h1></div>
    {!bankId ? <div className="panel pitch-empty">音源を開いてください</div> : <div className="panel color-panel">
      <div className="panel-heading"><div><h3>サブバンク</h3><p>{data ? `${data.rows.length}件の設定` : '読み込み中'}</p></div><span className="file-badge">YAML</span></div>
      {data && <><div className="color-toolbar"><label className="field color-choice"><span>色</span><select value={color} onChange={event => setColor(event.target.value)}>{colors.map(value => <option value={value} key={value}>{value || '(main)'}</option>)}</select></label><label className="field"><span>新しい色</span><input value={newColor} onChange={event => setNewColor(event.target.value)} placeholder="例: Soft"/></label><button className="secondary-button" disabled={!newColor.trim() || colors.includes(newColor.trim())} onClick={() => { const name = newColor.trim(); setExtraColors(previous => [...previous, name]); setColor(name); setNewColor(''); }}>色を追加</button></div><div className="color-layout"><div className="color-notes" role="listbox" aria-label="音高別のVoiceColor" aria-multiselectable="true" onKeyDown={handleNoteListKeyDown}><div className="color-row color-head"><span>音高</span><span>prefix</span><span>suffix</span></div>{notes.map(midi => { const row = rows.find(item => includesNote(item, midi)); return <button type="button" role="option" aria-selected={selected.includes(midi)} className={`color-row color-selectable ${selected.includes(midi) ? 'selected' : ''} ${midi % 12 === 0 ? 'octave' : ''}`} key={midi} onClick={event => selectNote(midi, event)}><strong>{fromMidi(midi)}</strong><span>{row?.prefix || '—'}</span><span>{row?.suffix || '—'}</span></button>; })}</div><div className="color-ranges"><div className="color-selection-heading"><h3>選択中の音高: {selected.length}音</h3><div><button className="secondary-button" disabled={selected.length === notes.length} onClick={selectAll}>全選択</button><button className="secondary-button" disabled={!selected.length} onClick={() => setSelected([])}>選択解除</button></div></div><p>Shiftで範囲選択、Ctrlで複数選択、Ctrl+Aで全選択</p><label className="field"><span>prefix</span><input value={prefix} onChange={event => setPrefix(event.target.value)}/></label><label className="field"><span>suffix</span><input value={suffix} onChange={event => setSuffix(event.target.value)}/></label><button className="primary-button color-apply" disabled={!data.writable || !selected.length} onClick={apply}>選択した音高に適用</button><h3>設定されている音域</h3>{rows.map((row, index) => <div className="color-range" key={index}><strong>{row.toneRanges.join('、')}</strong><span>{row.prefix || '（prefixなし）'} / {row.suffix || '（suffixなし）'}</span></div>)}</div></div><div className="color-save"><span>{dirty ? '未保存の変更があります' : '変更なし'}</span><button className="primary-button" disabled={!dirty || !data.writable || busy} onClick={() => setConfirm(true)}>変更を確認して保存</button></div></>}
      {data?.warnings.length ? <div className="pitch-warning">{data.warnings.join(' / ')}</div> : null}{error && <div className="pitch-error" role="alert">{error}</div>}
    </div>}{confirm && <div className="modal-backdrop"><div className="modal"><h2>VoiceColorの保存</h2><p>character.yamlを更新します。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(false)}>戻る</button><button className="primary-button" disabled={busy} onClick={save}>保存する</button></div></div></div>}
  </section>;
}
