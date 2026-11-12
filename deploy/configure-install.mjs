import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateDeployment(organization, locale) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(organization)) {
    throw new Error('Organization/realm must be 1-64 letters, numbers, underscores, or hyphens, and start with a letter or number.');
  }
  if (!['pt-PT', 'en-US'].includes(locale)) throw new Error('Locale must be pt-PT or en-US.');
}

export function createRealm(source, { organization, clientSecret, publicBaseUrl }) {
  const realm = structuredClone(source);
  realm.realm = organization;
  realm.displayName = organization;
  const settingsClient = realm.clients.find((client) => client.clientId === 'simoes-settings-admin');
  if (settingsClient) settingsClient.secret = clientSecret;
  const baseUrl = publicBaseUrl.replace(/\/$/, '');
  const webClient = realm.clients.find((client) => client.clientId === 'simoes-web');
  if (webClient && baseUrl) {
    webClient.redirectUris = [`${baseUrl}/*`];
    webClient.webOrigins = [baseUrl];
    webClient.attributes = { ...webClient.attributes, 'post.logout.redirect.uris': `${baseUrl}/*` };
  }
  return realm;
}

function secureRealmFile(descriptor) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    fs.fchownSync(descriptor, 0, 0);
  }
  fs.fchmodSync(descriptor, 0o640);
}

export function writeRealmFile({ templatePath, realmPath, organization, locale, clientSecret, publicBaseUrl }) {
  validateDeployment(organization, locale);
  if (!clientSecret) throw new Error('Keycloak settings client secret is required.');
  const source = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const realm = createRealm(source, { organization, clientSecret, publicBaseUrl });
  fs.mkdirSync(path.dirname(realmPath), { recursive: true });

  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  const preserveExisting = () => {
    let descriptor;
    try {
      descriptor = fs.openSync(realmPath, flags);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error.code === 'ELOOP') throw new Error('Refusing to use a symbolic link as the generated Keycloak realm file.');
      throw error;
    }
    try {
      if (!fs.fstatSync(descriptor).isFile()) {
        throw new Error('Refusing to use a non-regular generated Keycloak realm file.');
      }
      const existing = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
      if (existing.realm !== organization) {
        throw new Error(`Refusing to overwrite realm file for ${existing.realm} with ${organization}.`);
      }
      secureRealmFile(descriptor);
      return false;
    } finally {
      fs.closeSync(descriptor);
    }
  };

  const existingResult = preserveExisting();
  if (existingResult !== null) return existingResult;

  const createFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
  let descriptor;
  try {
    descriptor = fs.openSync(realmPath, createFlags, 0o640);
  } catch (error) {
    if (error.code === 'EEXIST') {
      const result = preserveExisting();
      if (result !== null) return result;
    }
    if (error.code === 'ELOOP') throw new Error('Refusing to create the generated Keycloak realm file through a symbolic link.');
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(realm, null, 2)}\n`);
    secureRealmFile(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return true;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}.`);
  return args[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const created = writeRealmFile({
      templatePath: option(args, '--template'),
      realmPath: option(args, '--realm-file'),
      organization: option(args, '--organization'),
      locale: option(args, '--locale'),
      clientSecret: option(args, '--client-secret'),
      publicBaseUrl: option(args, '--public-base-url'),
    });
    console.log(created ? 'created' : 'preserved');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
