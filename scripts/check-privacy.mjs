import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const allowedProfileNames = new Set(['public', 'default', 'default user', 'example', 'user', 'username', 'runneradmin']);
const findings = [];

for (const file of tracked) {
  let bytes;
  try { bytes = readFileSync(file); } catch { continue; }
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const windowsProfiles = [...line.matchAll(/[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]([^\\/\s"'<>]+)/gi)];
    for (const match of windowsProfiles) {
      if (!allowedProfileNames.has(match[1].toLowerCase())) findings.push(`${file}:${index + 1} Windowsユーザーパス`);
    }
    const unixProfiles = [...line.matchAll(/\/(?:Users|home)\/([^/\s"'<>]+)/g)];
    for (const match of unixProfiles) {
      if (!allowedProfileNames.has(match[1].toLowerCase())) findings.push(`${file}:${index + 1} Unixユーザーパス`);
    }
    if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line)) findings.push(`${file}:${index + 1} メールアドレス候補`);
    if (/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/.test(line)) findings.push(`${file}:${index + 1} GitHubトークン候補`);
    if (/AKIA[0-9A-Z]{16}/.test(line)) findings.push(`${file}:${index + 1} AWSアクセスキー候補`);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(line)) findings.push(`${file}:${index + 1} 秘密鍵候補`);
  });
}

if (findings.length) {
  console.error('公開できない可能性がある情報を検出しました。');
  findings.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`Privacy check passed (${tracked.length} files)`);
