globalThis.utauPlugin = {
  async run(command, api) {
    if (command !== 'check') throw new Error('不明なコマンドです');
    const files = await api.listFiles();
    const exact = new Set(files);
    const lower = new Map(files.map(file => [file.toLowerCase(), file]));
    const problems = [];
    const warnings = [];
    const information = [];
    const wavs = files.filter(file => /\.wav$/i.test(file));
    const otos = files.filter(file => /(?:^|\/)oto\.ini$/i.test(file));
    const frqs = files.filter(file => /\.frq$/i.test(file));
    const llsms = files.filter(file => /\.llsm$/i.test(file));
    const pmks = files.filter(file => /\.pmk$/i.test(file));
    const rootFile = name => lower.get(name.toLowerCase());

    if (!rootFile('character.txt')) problems.push('親フォルダにcharacter.txtがありません');
    else if (!exact.has('character.txt')) warnings.push('character.txtの大文字・小文字を確認してください');
    if (!wavs.length) problems.push('WAVファイルがありません');
    if (!otos.length) problems.push('oto.iniがありません');
    if (!rootFile('readme.txt')) warnings.push('親フォルダにreadme.txtがありません');
    if (!rootFile('character.yaml')) information.push('character.yamlはありません（従来UTAUでは不要です）');
    if (!rootFile('prefix.map')) information.push('prefix.mapはありません（単音階では不要な場合があります）');

    const unwanted = files.filter(file => /(?:^|\/)(?:\$read|thumbs\.db|\.ds_store)$/i.test(file) || /(?:\.bak|\.backup|\.tmp)$/i.test(file));
    if (unwanted.length) warnings.push(`配布前に確認したいファイル ${unwanted.length}件: ${unwanted.slice(0, 8).join('、')}${unwanted.length > 8 ? ' ほか' : ''}`);

    const character = rootFile('character.txt');
    if (character) {
      try {
        const text = await api.readText(character, 'auto');
        if (!/^name\s*=\s*\S+/im.test(text || '')) warnings.push('character.txtに音源名の指定がありません');
        const image = /^image\s*=\s*(.+)$/im.exec(text || '')?.[1]?.trim();
        if (image) {
          const normalized = image.replaceAll('\\', '/').replace(/^\.\//, '');
          if (!exact.has(normalized)) warnings.push(`character.txtの画像が見つかりません: ${image}`);
        }
      } catch { warnings.push('character.txtを読み取れませんでした'); }
    }

    const referenced = new Set();
    let aliasCount = 0;
    let checkedOtos = 0;
    for (const oto of otos.slice(0, 500)) {
      let content;
      try { content = await api.readText(oto, 'auto'); }
      catch { warnings.push(`${oto}を読み取れませんでした`); continue; }
      checkedOtos++;
      const folder = oto.includes('/') ? oto.slice(0, oto.lastIndexOf('/') + 1) : '';
      const aliases = new Set();
      let lineNumber = 0;
      for (const raw of (content || '').split(/\r?\n/)) {
        lineNumber++;
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const separator = line.indexOf('=');
        if (separator < 1) { warnings.push(`${oto}:${lineNumber} 原音設定の書式を確認してください`); continue; }
        const wavName = line.slice(0, separator).trim().replaceAll('\\', '/');
        const fields = line.slice(separator + 1).split(',');
        const wavPath = folder + wavName;
        if (wavName.startsWith('/') || wavName.split('/').some(part => !part || part === '..') || !/\.wav$/i.test(wavName)) {
          warnings.push(`${oto}:${lineNumber} WAVの指定を確認してください`);
        } else if (!exact.has(wavPath)) {
          warnings.push(`${oto}:${lineNumber} WAVが見つかりません: ${wavName}`);
        } else referenced.add(wavPath);
        const alias = (fields[0] || '').trim();
        if (alias) {
          aliasCount++;
          if (aliases.has(alias)) warnings.push(`${oto}:${lineNumber} エイリアスが重複しています: ${alias}`);
          aliases.add(alias);
        }
        if (fields.length !== 6 || fields.slice(1).some(value => value.trim() && !Number.isFinite(Number(value.trim())))) {
          warnings.push(`${oto}:${lineNumber} 原音設定の数値欄を確認してください`);
        }
        if (problems.length + warnings.length > 200) break;
      }
      if (problems.length + warnings.length > 200) break;
    }
    if (otos.length > 500) warnings.push(`oto.iniが多いため先頭500件を確認しました（全${otos.length}件）`);
    const unreferenced = wavs.filter(file => !referenced.has(file));
    if (unreferenced.length && checkedOtos === otos.length) warnings.push(`oto.iniで参照されていないWAV ${unreferenced.length}件: ${unreferenced.slice(0, 8).join('、')}${unreferenced.length > 8 ? ' ほか' : ''}`);

    const map = rootFile('prefix.map');
    if (map) {
      try {
        const lines = (await api.readText(map, 'auto') || '').split(/\r?\n/).filter(line => line.trim());
        if (!lines.length) warnings.push('prefix.mapが空です');
        else information.push(`prefix.map: ${lines.length}行`);
      } catch { warnings.push('prefix.mapを読み取れませんでした'); }
    }

    const section = (title, rows) => `${title}\n${rows.length ? rows.map(row => `・${row}`).join('\n') : '・なし'}`;
    return [
      `配布前チェック — ${api.voicebank.name}`,
      `WAV ${wavs.length} / oto.ini ${otos.length} / FRQ ${frqs.length} / LLSM ${llsms.length} / PMK ${pmks.length} / エイリアス ${aliasCount}`,
      '',
      section('問題', problems),
      '',
      section('確認事項', warnings),
      '',
      section('補足', information),
      '',
      'この結果はファイル構成の簡易確認です。配布前にUTAU・OpenUtauで読み込みも確認してください。'
    ].join('\n');
  }
};
