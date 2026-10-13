export type PluginManifest = {
  apiVersion: 1;
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  builtIn?: boolean;
  permissions: ('voicebank:read' | 'voicebank:write')[];
  commands: { id: string; title: string }[];
};

type PluginRun = { runId: string; source: string; voicebank: { name: string } };

const runner = `
const pending = new Map();
let nextId = 0;
function invoke(method, args) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    postMessage({ type: 'call', id, method, args });
  });
}
self.addEventListener('message', async event => {
  const data = event.data;
  if (data?.type === 'reply') {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.ok) request.resolve(data.value);
    else request.reject(new Error(data.error));
    return;
  }
  if (data?.type !== 'start') return;
  try {
    if (!self.utauPlugin || typeof self.utauPlugin.run !== 'function') throw new Error('utauPlugin.run が見つかりません');
    const api = Object.freeze({
      voicebank: Object.freeze(data.voicebank),
      listFiles: () => invoke('listFiles', []),
      readText: (relativePath, encoding) => invoke('readText', [relativePath, encoding]),
      writeText: (relativePath, text) => invoke('writeText', [relativePath, text])
    });
    const result = await self.utauPlugin.run(data.commandId, api);
    let output = typeof result === 'string' ? result : JSON.stringify(result ?? '完了');
    if (output.length > 32000) output = output.slice(0, 32000) + '…';
    postMessage({ type: 'done', output });
  } catch (error) {
    postMessage({ type: 'failed', error: String(error?.message || error) });
  }
});`;

export async function runPlugin(id: string, commandId: string, voicebankId: string): Promise<{ output: string; wrote: boolean } | null> {
  const started: PluginRun | null = await window.voicebankApi.beginPluginRun(id, commandId, voicebankId);
  if (!started) return null;
  const blob = new Blob([started.source, '\n', runner], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  let worker: Worker | null = null;
  let output = '';
  let wrote = false;
  try {
    worker = new Worker(url);
    const active = worker;
    output = await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('プラグインの実行時間が上限を超えました')), 20000);
      let finished = false;
      const complete = (error?: Error, value?: string) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        if (error) reject(error); else resolve(value || '完了');
      };
      active.onerror = event => { event.preventDefault(); complete(new Error('プラグインのJavaScriptを実行できません')); };
      active.onmessageerror = () => complete(new Error('プラグインの応答を読み取れません'));
      active.onmessage = event => {
        const data = event.data;
        if (data?.type === 'done') { complete(undefined, String(data.output || '完了')); return; }
        if (data?.type === 'failed') { complete(new Error(String(data.error || '実行に失敗しました'))); return; }
        if (data?.type !== 'call' || !Number.isInteger(data.id)) return;
        void window.voicebankApi.callPluginApi(started.runId, data.method, data.args).then(
          value => active.postMessage({ type: 'reply', id: data.id, ok: true, value }),
          error => active.postMessage({ type: 'reply', id: data.id, ok: false, error: String(error instanceof Error ? error.message : error) })
        ).catch(() => {});
      };
      active.postMessage({ type: 'start', commandId, voicebank: started.voicebank });
    });
  } finally {
    worker?.terminate();
    URL.revokeObjectURL(url);
    wrote = (await window.voicebankApi.endPluginRun(started.runId)).wrote;
  }
  return { output, wrote };
}
