const iconv = require('iconv-lite');

function makeReadme(name, author = '') {
  const title = String(name || '').trim();
  const creator = String(author || '').trim();
  if (!title || /[\r\n]/.test(title) || /[\r\n]/.test(creator)) throw new Error('readme.txtに使用する音源情報を確認してください');
  const lines = [
    `【${title} 音声ライブラリ】`,
    '',
    '■エイリアスについて',
    '-----------------------',
    '',
    '-----------------------',
    '',
    '■詳細',
    `・名前：${title}`,
    ...(creator ? [`・制作者：${creator}`] : []),
    ''
  ];
  const content = lines.join('\r\n');
  const encoded = iconv.encode(content, 'cp932');
  if (iconv.decode(encoded, 'cp932') !== content) throw new Error('readme.txtにANSI (CP932)で表現できない文字があります');
  return encoded;
}

module.exports = { makeReadme };
