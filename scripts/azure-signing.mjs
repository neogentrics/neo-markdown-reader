// Adds the Azure Artifact Signing settings to package.json on the build machine, so the usual
// build signs the Windows files. Only the Release workflow runs this, and only once signing is
// set up: see docs/release-channels.md. Don't commit the result.
//
// The settings go in the file, not on the command line, because npm on Windows damages an
// argument with a space in it, and a publisher name usually has one.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function withAzureSigning(pkg, env) {
  const options = {
    endpoint: env.SIGN_ENDPOINT,
    codeSigningAccountName: env.SIGN_ACCOUNT,
    certificateProfileName: env.SIGN_PROFILE,
    publisherName: env.SIGN_PUBLISHER,
  };
  const missing = Object.keys(options).filter((key) => !options[key]);
  if (missing.length) throw new Error(`Azure signing is missing: ${missing.join(', ')}. See docs/release-channels.md.`);
  return { ...pkg, build: { ...pkg.build, win: { ...pkg.build.win, azureSignOptions: options } } };
}

function main() {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, `${JSON.stringify(withAzureSigning(pkg, process.env), null, 2)}\n`);
  console.log(`Windows builds will be signed as ${process.env.SIGN_PUBLISHER}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error(e.message); process.exit(1); }
}
