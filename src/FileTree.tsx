import { useEffect, useState } from 'react';
import { deleteReadFiles, findReadFiles, listVoicebankFiles, type FileTreeNode, type ReadFile, type VoicebankFiles } from './voicebank';

function TreeNode({ node, path = '', root = false, onSelect }: { node: FileTreeNode; path?: string; root?: boolean; onSelect(path: string): void }) {
  const nextPath = path ? `${path}/${node.name}` : node.name;
  if (node.type === 'directory') return <details className="file-folder" open={root}><summary><span className="file-symbol">▸</span><span>{node.name}</span><small>{node.children?.length || 0}</small></summary><div className="file-children">{node.children?.map(child => <TreeNode key={child.name} node={child} path={root ? '' : nextPath} onSelect={onSelect}/>)}</div></details>;
  return <button className="file-item" onClick={() => onSelect(nextPath)}><span className="file-symbol">▤</span><span>{node.name}</span></button>;
}

export default function FileTree({ bankId, notify }: { bankId: string | null; notify(message: string): void }) {
  const [data, setData] = useState<VoicebankFiles | null>(null);
  const [readFiles, setReadFiles] = useState<ReadFile[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setData(null); setReadFiles([]); setSelected(''); setError('');
    if (bankId) void Promise.all([listVoicebankFiles(bankId), findReadFiles(bankId)]).then(([files, found]) => { if (live) { setData(files); setReadFiles(found); } }).catch(caught => { if (live) setError(String(caught instanceof Error ? caught.message : caught)); });
    return () => { live = false; };
  }, [bankId]);

  async function removeReadFiles() {
    if (!bankId || !readFiles.length || busy) return;
    setBusy(true); setError('');
    try {
      const result = await deleteReadFiles(bankId);
      const [files, found] = await Promise.all([listVoicebankFiles(bankId), findReadFiles(bankId)]);
      setData(files); setReadFiles(found); setSelected('');
      if (result.deleted) notify(`$read ${result.deleted}件を削除しました`);
    } catch (caught) {
      setError(String(caught instanceof Error ? caught.message : caught));
      void Promise.all([listVoicebankFiles(bankId), findReadFiles(bankId)]).then(([files, found]) => { setData(files); setReadFiles(found); }).catch(() => {});
    } finally { setBusy(false); }
  }

  return <section className="page active"><div className="subpage-head"><h1>階層確認</h1></div>
    {!bankId ? <div className="panel pitch-empty">音源を開いてください</div> : <div className="panel file-panel"><div className="panel-heading"><div><h3>ファイル階層</h3><p>{data ? `${data.count.toLocaleString()}件` : '読み込み中'}</p></div></div>{data && <><div className="read-cleanup"><div><h3>$read</h3><p>{readFiles.length ? `${readFiles.length}件を検出` : '検出なし'}</p></div><button className="secondary-button" disabled={!readFiles.length || busy} onClick={() => { void removeReadFiles(); }}>{busy ? '処理中…' : '検出した$readを削除'}</button></div>{readFiles.length > 0 && <div className="read-file-list">{readFiles.map(file => <span key={file.path}>{file.path}</span>)}</div>}<div className="file-tree"><TreeNode node={data.tree} root onSelect={setSelected}/></div>{selected && <div className="file-selection">{selected}</div>}{data.truncated && <div className="pitch-warning">表示上限の50,000件に達しました</div>}</>}{error && <div className="pitch-error" role="alert">{error}</div>}</div>}
  </section>;
}
