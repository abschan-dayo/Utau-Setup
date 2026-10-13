import { useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { readFrqFolderPitches, readPitchSources, readPrefixMap, savePrefixMap, type PrefixEntry, type PrefixMap, type SavePendingHandle } from './voicebank';

type Source = PrefixEntry & { id: number };
type EntryGroup = { low: number; high: number; prefix: string; suffix: string };
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const allNotes = Array.from({ length: 84 }, (_, index) => 107 - index);

function toMidi(note: string): number | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!match) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[match[1].toUpperCase() as 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'];
  const midi = (Number(match[3]) + 1) * 12 + base + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  return midi >= 0 && midi <= 127 ? midi : null;
}

function fromMidi(midi: number): string { return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`; }

export default function PitchMap({ bankId, notify, onDirtyChange, ref }: { bankId: string | null; notify(message: string): void; onDirtyChange(dirty: boolean): void; ref?: Ref<SavePendingHandle> }) {
  const [map, setMap] = useState<PrefixMap | null>(null);
  const [entries, setEntries] = useState<PrefixEntry[]>([]);
  const [baseline, setBaseline] = useState<PrefixEntry[]>([]);
  const [sources, setSources] = useState<Source[]>([{ id: 1, note: '', prefix: '', suffix: '' }]);
  const [nextId, setNextId] = useState(2);
  const [start, setStart] = useState('C3');
  const [end, setEnd] = useState('C5');
  const [rangeStart, setRangeStart] = useState('A3');
  const [rangeEnd, setRangeEnd] = useState('A4');
  const [rangePrefix, setRangePrefix] = useState('');
  const [rangeSuffix, setRangeSuffix] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<number[]>([60]);
  const [editPrefix, setEditPrefix] = useState('');
  const [editSuffix, setEditSuffix] = useState('');
  const lastSelected = useRef(60);
  const dirty = useMemo(() => JSON.stringify(entries) !== JSON.stringify(baseline), [entries, baseline]);
  const groups = useMemo(() => {
    const ascending = [...entries].map(row => ({ row, midi: toMidi(row.note)! })).sort((a, b) => a.midi - b.midi);
    const result: EntryGroup[] = [];
    for (const { row, midi } of ascending) {
      const previous = result[result.length - 1];
      if (previous && previous.high + 1 === midi && previous.prefix === row.prefix && previous.suffix === row.suffix) previous.high = midi;
      else result.push({ low: midi, high: midi, prefix: row.prefix, suffix: row.suffix });
    }
    return result.reverse();
  }, [entries]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    let live = true;
    setMap(null);
    setEntries([]);
    setBaseline([]);
    setSelectedNotes([60]);
    lastSelected.current = 60;
    setError('');
    if (!bankId) return;
    void readPrefixMap(bankId).then(result => {
      if (!live) return;
      setMap(result);
      const ordered = [...result.entries].sort((a, b) => toMidi(b.note)! - toMidi(a.note)!);
      setEntries(ordered);
      setBaseline(ordered);
    }).catch(caught => { if (live) setError(String(caught instanceof Error ? caught.message : caught)); });
    return () => { live = false; };
  }, [bankId]);

  function updateSource(id: number, field: keyof PrefixEntry, value: string) {
    setSources(previous => previous.map(row => row.id === id ? { ...row, [field]: value } : row));
  }

  async function loadSources() {
    if (!bankId) return;
    setError('');
    try {
      const detected = await readPitchSources(bankId);
      if (!detected.length) { notify('音階を推定できるFRQファイルがありませんでした'); return; }
      setSources(detected.map((row, index) => ({ ...row, id: index + 1 })));
      setNextId(detected.length + 1);
      notify(`${detected.length}件の音階をFRQから読み込みました`);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
  }

  async function generateFromFolders() {
    if (!bankId) return;
    setError('');
    try {
      const recorded = await readFrqFolderPitches(bankId);
      if (!recorded.length) { setError('FRQに対応するサブフォルダ内oto.iniからSuffixを読み取れませんでした'); return; }
      const generated: PrefixEntry[] = [];
      for (let midi = toMidi('C1')!; midi <= toMidi('B7')!; midi++) {
        const selected = [...recorded].sort((a, b) => Math.abs(midi - a.midi) - Math.abs(midi - b.midi) || a.midi - b.midi || a.folder.localeCompare(b.folder))[0];
        generated.push({ note: fromMidi(midi), prefix: '', suffix: selected.suffix });
      }
      setEntries(generated.sort((a, b) => toMidi(b.note)! - toMidi(a.note)!));
      notify(`FRQから${recorded.length}件の収録音高を読み取り、C1～B7の84音にSuffixを設定しました`);
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); }
  }

  function generate() {
    setError('');
    const first = toMidi(start);
    const last = toMidi(end);
    if (first === null || last === null || first > last) { setError('開始音と終了音を確認してください'); return; }
    const parsedSources = sources.map(row => ({ ...row, midi: toMidi(row.note) }));
    if (!parsedSources.length || parsedSources.some(row => row.midi === null)) { setError('収録音高を確認してください'); return; }
    const uniqueSources = new Map<number, typeof parsedSources[number]>();
    for (const row of parsedSources) {
      const previous = uniqueSources.get(row.midi!);
      if (previous && (previous.prefix !== row.prefix || previous.suffix !== row.suffix)) {
        setError(`${row.note}に異なるprefix／suffixが複数あります。収録音高ごとに割り当てを1組にしてください`);
        return;
      }
      if (!previous) uniqueSources.set(row.midi!, row);
    }
    const recorded = [...uniqueSources.values()];
    const merged = new Map(entries.map(row => [toMidi(row.note), row]));
    for (let midi = first; midi <= last; midi++) {
      const selected = [...recorded].sort((a, b) => Math.abs(midi - a.midi!) - Math.abs(midi - b.midi!) || a.midi! - b.midi!)[0];
      merged.set(midi, { note: fromMidi(midi), prefix: selected.prefix, suffix: selected.suffix });
    }
    setEntries([...merged.values()].sort((a, b) => toMidi(b.note)! - toMidi(a.note)!));
    notify(`${last - first + 1}音の割り当てを作成しました`);
  }

  function applyRange() {
    setError('');
    const first = toMidi(rangeStart);
    const last = toMidi(rangeEnd);
    if (first === null || last === null || first > last) { setError('設定範囲の音高を確認してください'); return; }
    const updated = new Map(entries.map(row => [toMidi(row.note)!, row]));
    for (let midi = first; midi <= last; midi++) updated.set(midi, { note: fromMidi(midi), prefix: rangePrefix, suffix: rangeSuffix });
    setEntries([...updated.values()].sort((a, b) => toMidi(b.note)! - toMidi(a.note)!));
    notify(`${rangeStart}～${rangeEnd}にprefix／suffixを設定しました`);
  }

  function updateGroup(group: EntryGroup, field: 'prefix' | 'suffix', value: string) {
    setEntries(previous => previous.map(row => {
      const midi = toMidi(row.note)!;
      return midi >= group.low && midi <= group.high ? { ...row, [field]: value } : row;
    }));
  }

  function selectNote(midi: number, event: MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey) {
      const low = Math.min(lastSelected.current, midi);
      const high = Math.max(lastSelected.current, midi);
      setSelectedNotes(Array.from({ length: high - low + 1 }, (_, index) => low + index));
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedNotes(previous => previous.includes(midi) ? previous.filter(value => value !== midi) : [...previous, midi]);
      lastSelected.current = midi;
    } else {
      setSelectedNotes([midi]);
      lastSelected.current = midi;
    }
    const current = entries.find(row => toMidi(row.note) === midi);
    setEditPrefix(current?.prefix || '');
    setEditSuffix(current?.suffix || '');
  }

  function applySelected() {
    if (!selectedNotes.length) return;
    const updated = new Map(entries.map(row => [toMidi(row.note)!, row]));
    for (const midi of selectedNotes) updated.set(midi, { note: fromMidi(midi), prefix: editPrefix, suffix: editSuffix });
    setEntries([...updated.values()].sort((a, b) => toMidi(b.note)! - toMidi(a.note)!));
    notify(`${selectedNotes.length}音の割り当てを変更しました`);
  }

  function selectAll() {
    setSelectedNotes([...allNotes]);
    lastSelected.current = allNotes[0];
  }

  function handleNoteListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAll();
    }
  }

  async function save() {
    if (!bankId) return false;
    setBusy(true);
    setError('');
    try {
      const result = await savePrefixMap(bankId, entries);
      const next = [...(result.entries || entries)].sort((a, b) => toMidi(b.note)! - toMidi(a.note)!);
      setEntries(next);
      setBaseline(next);
      setMap(previous => previous ? { ...previous, exists: true } : previous);
      setConfirm(false);
      notify(result.saved ? 'prefix.mapを保存しました' : result.message || '変更はありません');
      return true;
    } catch (caught) { setError(String(caught instanceof Error ? caught.message : caught)); setConfirm(false); return false; }
    finally { setBusy(false); }
  }

  useImperativeHandle(ref, () => ({ savePending: () => dirty && map?.writable ? save() : Promise.resolve(!dirty) }));

  return <section className="page active"><div className="subpage-head"><h1>prifixmap</h1></div>
    {!bankId ? <div className="panel pitch-empty">音源を開いてください</div> : <>
      <div className="pitch-layout">
        <div className="panel pitch-editor">
          <div className="panel-heading"><div><h3>prefix.map</h3><p>{map ? `${map.exists ? '読み込み済み' : '新規作成'} · ${map.encoding}` : '読み込み中'}</p></div><span className="file-badge">MAP</span></div>
          <div className="pitch-controls">
            <div className="pitch-range"><label className="field"><span>開始音</span><input value={start} onChange={event => setStart(event.target.value)}/></label><label className="field"><span>終了音</span><input value={end} onChange={event => setEnd(event.target.value)}/></label></div>
            <h3>収録音高</h3>
            <div className="source-list">{sources.map(row => <div className="source-row" key={row.id}><input aria-label="収録音高" placeholder="C4" value={row.note} onChange={event => updateSource(row.id, 'note', event.target.value)}/><input aria-label="prefix" placeholder="prefix" value={row.prefix} onChange={event => updateSource(row.id, 'prefix', event.target.value)}/><input aria-label="suffix" placeholder="suffix" value={row.suffix} onChange={event => updateSource(row.id, 'suffix', event.target.value)}/><button aria-label="行を削除" disabled={sources.length === 1} onClick={() => setSources(previous => previous.filter(item => item.id !== row.id))}>×</button></div>)}</div>
            <div className="pitch-control-actions">
              <button className="secondary-button" onClick={() => { setSources(previous => [...previous, { id: nextId, note: '', prefix: '', suffix: '' }]); setNextId(nextId + 1); }}>＋ 音高を追加</button>
              <button className="secondary-button" disabled={!map?.writable} onClick={loadSources}>FRQから読込</button>
              <button className="primary-button" disabled={!map?.writable} onClick={generate}>割り当てを生成</button>
              <button className="primary-button" disabled={!map?.writable} onClick={generateFromFolders} aria-label="FRQから自動生成" title="FRQとoto.iniからC1～B7の割り当てを自動生成">自動生成</button>
            </div>
          </div>
        </div>
        <div className="panel pitch-results"><div className="panel-heading"><h3>割り当て</h3><span className="pitch-count">{entries.length} 音 · {groups.length} 範囲</span></div><div className="pitch-bulk-range"><strong>範囲設定</strong><div className="pitch-bulk-fields"><input aria-label="範囲の開始音" value={rangeStart} onChange={event => setRangeStart(event.target.value)} placeholder="A3"/><span>～</span><input aria-label="範囲の終了音" value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} placeholder="A4"/><input aria-label="範囲prefix" value={rangePrefix} onChange={event => setRangePrefix(event.target.value)} placeholder="prefix"/><input aria-label="範囲suffix" value={rangeSuffix} onChange={event => setRangeSuffix(event.target.value)} placeholder="suffix"/><button className="secondary-button" onClick={applyRange}>適用</button></div></div>{entries.length ? <div className="pitch-table"><div className="pitch-table-header"><span>音域</span><span>prefix</span><span>suffix</span></div>{groups.map(group => <div className="pitch-table-row" key={`${group.low}-${group.high}`}><strong>{group.low === group.high ? fromMidi(group.low) : `${fromMidi(group.high)}～${fromMidi(group.low)}`}</strong><input aria-label={`${fromMidi(group.low)}～${fromMidi(group.high)} prefix`} value={group.prefix} onChange={event => updateGroup(group, 'prefix', event.target.value)}/><input aria-label={`${fromMidi(group.low)}～${fromMidi(group.high)} suffix`} value={group.suffix} onChange={event => updateGroup(group, 'suffix', event.target.value)}/></div>)}</div> : <div className="pitch-no-entries">割り当てはありません</div>}<div className="pitch-save"><span>{dirty ? '未保存の変更があります' : '変更はありません'}</span><button className="primary-button" disabled={!dirty || !map?.writable || busy} onClick={() => setConfirm(true)}>{map?.exists ? '変更を確認して保存' : 'prefix.mapを作成'}</button></div></div>
      </div>
      <div className="panel pitch-note-panel"><div className="panel-heading"><div><h3>音高ごとに編集</h3><p>クリックで選択 · Shiftで範囲選択 · Ctrlで複数選択 · Ctrl+Aで全選択</p></div><div className="pitch-selection-actions"><span className="pitch-count">{selectedNotes.length}音を選択</span><button className="secondary-button" disabled={selectedNotes.length === allNotes.length} onClick={selectAll}>全選択</button><button className="secondary-button" disabled={!selectedNotes.length} onClick={() => setSelectedNotes([])}>選択解除</button></div></div><div className="pitch-note-layout"><div className="pitch-note-list" role="listbox" aria-label="音高の割り当て" aria-multiselectable="true" onKeyDown={handleNoteListKeyDown}>{allNotes.map(midi => { const entry = entries.find(row => toMidi(row.note) === midi); return <button type="button" role="option" aria-selected={selectedNotes.includes(midi)} className={`pitch-note ${selectedNotes.includes(midi) ? 'selected' : ''} ${midi % 12 === 0 ? 'octave' : ''}`} key={midi} onClick={event => selectNote(midi, event)}><strong>{fromMidi(midi)}</strong><span>{entry ? `${entry.prefix}${entry.suffix}` || '（指定なし）' : '—'}</span></button>; })}</div><div className="pitch-note-fields"><label className="field"><span>prefix</span><input value={editPrefix} onChange={event => setEditPrefix(event.target.value)}/></label><label className="field"><span>suffix</span><input value={editSuffix} onChange={event => setEditSuffix(event.target.value)}/></label><button className="primary-button" disabled={!selectedNotes.length || !map?.writable} onClick={applySelected}>選択した音高に適用</button></div></div></div>
      {map?.warnings.length ? <div className="pitch-warning">{map.warnings.length}件の既存行を確認してください：{map.warnings.slice(0, 3).join(' / ')}</div> : null}
      {error && <div className="pitch-error" role="alert">{error}</div>}
    </>}
    {confirm && <div className="modal-backdrop"><div className="modal"><h2>prefix.map の保存</h2><p>{entries.length}音の割り当てを保存します。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setConfirm(false)}>戻る</button><button className="primary-button" disabled={busy} onClick={save}>保存する</button></div></div></div>}
  </section>;
}
