import { useState } from 'react';
import { runPlugin, type PluginManifest } from './plugin-runtime';
import './plugins.css';

type Props = {
  bankId: string | null;
  hasUnsavedChanges: boolean;
  items: PluginManifest[];
  pluginId: string | null;
  onItemsChanged(items: PluginManifest[]): void;
  onOpen(id: string): void;
  notify(message: string): void;
  onWritten(): Promise<void>;
};

export default function Plugins({ bankId, hasUnsavedChanges, items, pluginId, onItemsChanged, onOpen, notify, onWritten }: Props) {
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const selected = items.find(item => item.id === pluginId);

  async function refresh() {
    try { onItemsChanged(await window.voicebankApi.listPlugins()); }
    catch (error) { notify(String(error instanceof Error ? error.message : error)); }
  }

  async function install() {
    setBusy(true);
    try {
      if (await window.voicebankApi.installPlugin()) {
        await refresh();
        notify('プラグインを追加しました');
      }
    } catch (error) { notify(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  }

  async function exportTemplate() {
    setBusy(true);
    try { if (await window.voicebankApi.exportPluginTemplate()) notify('プラグインの雛形を保存しました'); }
    catch (error) { notify(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      if (await window.voicebankApi.removePlugin(id)) {
        await refresh();
        setOutput('');
        notify('プラグインを削除しました');
      }
    } catch (error) { notify(String(error instanceof Error ? error.message : error)); }
    finally { setBusy(false); }
  }

  async function run(id: string, commandId: string) {
    if (!bankId) return;
    setBusy(true);
    setOutput('');
    try {
      const result = await runPlugin(id, commandId, bankId);
      if (result !== null) {
        setOutput(result.output);
        if (result.wrote) await onWritten();
        notify('プラグインを実行しました');
      }
    } catch (error) {
      if (items.find(item => item.id === id)?.permissions.includes('voicebank:write')) await onWritten().catch(() => {});
      notify(String(error instanceof Error ? error.message : error));
    }
    finally { setBusy(false); }
  }

  return <section className="page active"><div className="subpage-head plugin-heading"><h1>{selected?.name || 'プラグイン管理'}</h1>{!pluginId && <div className="plugin-heading-actions"><button className="secondary-button" disabled={busy} onClick={() => { void exportTemplate(); }}>雛形を保存</button><button className="primary-button" disabled={busy} onClick={() => { void install(); }}>＋ フォルダから追加</button></div>}</div>
    {busy && <div className="plugin-busy"><span className="working-spinner"/>処理中…</div>}
    {hasUnsavedChanges && <div className="plugin-notice">未保存の変更を保存してからプラグインを実行してください。</div>}
    {pluginId ? selected ? <div className="panel plugin-card"><div className="plugin-card-head"><div><h3>{selected.name} <small>v{selected.version}{selected.builtIn ? ' · 標準' : ''}</small></h3><p className="plugin-author">製作者名義: {selected.author || '未設定'}</p><p>{selected.description}</p></div></div><div className="plugin-permissions">{selected.permissions.includes('voicebank:write') ? '音源内のテキストを読み書き' : selected.permissions.includes('voicebank:read') ? '音源内のテキストを読み取り' : '音源名のみ'}</div><div className="plugin-commands">{selected.commands.map(command => <button key={command.id} className="secondary-button" disabled={busy || !bankId || hasUnsavedChanges} onClick={() => { void run(selected.id, command.id); }}>{command.title}</button>)}</div></div> : <div className="panel plugin-empty">プラグインが見つかりません。</div>
      : items.length ? <div className="plugin-list">{items.map(plugin => <div className="panel plugin-card" key={plugin.id}><div className="plugin-card-head"><div><h3>{plugin.name} <small>v{plugin.version}{plugin.builtIn ? ' · 標準' : ''}</small></h3><p className="plugin-author">製作者名義: {plugin.author || '未設定'}</p><p>{plugin.description}</p></div><div className="plugin-heading-actions"><button className="secondary-button" onClick={() => { setOutput(''); onOpen(plugin.id); }}>開く</button>{!plugin.builtIn && <button className="secondary-button" disabled={busy} onClick={() => { void remove(plugin.id); }}>削除</button>}</div></div></div>)}</div> : <div className="panel plugin-empty">プラグインはまだありません。雛形のフォルダを選んで追加できます。</div>}
    {output && <div className="panel plugin-output"><h3>実行結果</h3><pre>{output}</pre></div>}
  </section>;
}
