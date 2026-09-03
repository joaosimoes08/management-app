import { randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const target = resolve(process.argv[2] ?? 'secrets/snmp-keyring.json');
await mkdir(dirname(target), { recursive: true, mode: 0o700 });
const file = await open(target, 'wx', 0o600);
try {
  await file.writeFile(`${JSON.stringify({ activeKeyId: 'v1', keys: { v1: randomBytes(32).toString('base64') } }, null, 2)}\n`, { encoding: 'utf8' });
  console.info(`Keyring SNMP criado em ${target}`);
} finally { await file.close(); }
