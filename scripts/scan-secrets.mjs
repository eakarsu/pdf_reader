import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patterns = [
  ['OpenAI/OpenRouter-style API key', /\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'buffer' },
)
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const findings = [];
for (const file of files) {
  let contents;
  try {
    contents = readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }

  if (contents.length > 2 * 1024 * 1024 || contents.includes(0)) continue;
  const source = contents.toString('utf8');
  for (const [label, pattern] of patterns) {
    if (pattern.test(source)) findings.push(`${file}: ${label}`);
  }
}

if (findings.length) {
  console.error('Potential secrets found (values redacted):');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Secret scan passed for ${files.length} current-tree files.`);
