// @ts-check
/// <reference path="./plugin-api.d.ts" />
// このフォルダをコピーし、plugin.json の ID・名前・製作者名義を変更してから編集してください。
// API の型と詳しい説明は PLUGIN_API.md を参照してください。
/** @type {UtauPlugin} */
globalThis.utauPlugin = {
  async run(command, api) {
    const files = await api.listFiles();
    const report = [
      `音源: ${api.voicebank.name}`,
      `ファイル数: ${files.length}`,
      '',
      ...files
    ].join('\n');

    if (command === 'show') return report;
    if (command === 'save') {
      // 既存ファイルを変更する場合は、先に readText で読み込む必要があります。
      await api.readText('plugin-report.txt');
      await api.writeText('plugin-report.txt', report + '\n');
      return 'plugin-report.txt を保存しました';
    }
    throw new Error('不明なコマンドです');
  }
};
