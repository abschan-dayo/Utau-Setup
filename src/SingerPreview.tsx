import { useEffect, useState } from 'react';
import type { Character, Voicebank } from './voicebank';
import './singer-preview.css';

export default function SingerPreview({ bank, txt, yaml, icons, readme, onClose }: { bank: Voicebank; txt: Character; yaml: Character; icons: { txt: string | null; yaml: string | null }; readme: string; onClose(): void }) {
  const [target, setTarget] = useState<'utau' | 'openutau'>('utau');
  const [showReadme, setShowReadme] = useState(false);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  const open = bank.yaml.exists ? yaml : txt;
  const icon = target === 'utau' ? icons.txt : bank.yaml.exists ? icons.yaml || icons.txt : icons.txt;
  const badge = <span className="singer-preview-icon">{icon ? <img src={icon} alt="音源アイコン"/> : <span>画像なし</span>}</span>;
  return <div className="portrait-preview-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="singer-preview-dialog" role="dialog" aria-modal="true" aria-label="音源表示確認"><header className="singer-preview-header"><h2>音源表示確認</h2><button className="secondary-button" onClick={onClose}>閉じる</button></header><div className="singer-preview-tabs" role="tablist"><button role="tab" aria-selected={target === 'utau'} onClick={() => { setTarget('utau'); setShowReadme(false); }}>UTAU</button><button role="tab" aria-selected={target === 'openutau'} onClick={() => { setTarget('openutau'); setShowReadme(false); }}>OpenUtau</button></div>{target === 'utau' ? <div className="singer-preview-utau"><div className="singer-preview-utau-title">原音のプロパティ</div><div className="singer-preview-utau-main">{badge}<div><strong>{txt.name || bank.name}</strong><span>Version {txt.version || '—'}</span></div></div><div className="singer-preview-readme">{readme || 'readme.txtはありません'}</div></div> : <div className="singer-preview-openutau"><div className="singer-preview-openutau-main">{badge}<div><strong>{open.name || bank.name}</strong><span>Author: {open.author || '—'}</span><span>Voice: {open.voice || '—'}</span><span>Web: {open.web || '—'}</span><span>Version: {open.version || '—'}</span></div></div><div className="singer-preview-openutau-actions"><button onClick={() => setShowReadme(previous => !previous)}>readme.txtを開く</button></div>{showReadme && <div className="singer-preview-openutau-readme">{readme || 'readme.txtはありません'}</div>}</div>}<p className="singer-preview-note">編集中の内容を反映した表示イメージです。</p></section></div>;
}
