import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveKeycloakDatabaseVolume(composeConfig) {
  const mounts = composeConfig.services?.['keycloak-db']?.volumes;
  const databaseMount = mounts?.find((mount) => mount.target === '/var/lib/postgresql/data');
  if (!databaseMount || databaseMount.type !== 'volume' || !databaseMount.source) {
    throw new Error('Compose config does not define a named volume for keycloak-db data.');
  }
  return composeConfig.volumes?.[databaseMount.source]?.name || databaseMount.source;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      console.log(resolveKeycloakDatabaseVolume(JSON.parse(input)));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
}
