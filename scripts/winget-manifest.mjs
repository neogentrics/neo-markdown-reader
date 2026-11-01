// Writes the winget manifests for a release, ready to submit to microsoft/winget-pkgs.
//
//   node scripts/winget-manifest.mjs                 # version from package.json, downloads the installer
//   node scripts/winget-manifest.mjs --file <Setup.exe> [--version 2.1.0]
//
// winget needs the installer's SHA-256, so run this after the release is published (or point
// --file at the built installer). Output: packaging/winget/manifests/n/NeoGentrics/NeoMarkdownReader/<version>/
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const ID = 'NeoGentrics.NeoMarkdownReader';
const REPO = 'https://github.com/neogentrics/neo-markdown-reader';

export function manifests({ version, sha256, url }) {
  const head = `# Created with scripts/winget-manifest.mjs\nPackageIdentifier: ${ID}\nPackageVersion: ${version}\n`;
  return {
    [`${ID}.yaml`]: `${head}DefaultLocale: en-US\nManifestType: version\nManifestVersion: 1.6.0\n`,
    [`${ID}.installer.yaml`]: `${head}InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
UpgradeBehavior: install
FileExtensions:
- md
- markdown
- mdown
- mkd
- mkdn
- mdx
- mdlock
Installers:
- Architecture: x64
  InstallerUrl: ${url}
  InstallerSha256: ${sha256.toUpperCase()}
ManifestType: installer
ManifestVersion: 1.6.0
`,
    [`${ID}.locale.en-US.yaml`]: `${head}PackageLocale: en-US
Publisher: Neo Gentrics
PublisherUrl: https://github.com/neogentrics
PublisherSupportUrl: ${REPO}/issues
PackageName: Neo Markdown Reader
PackageUrl: ${REPO}
License: Proprietary
LicenseUrl: ${REPO}/blob/main/LICENSE
Copyright: Copyright (c) 2026 Neo Gentrics. All rights reserved.
ShortDescription: A beautiful, distraction-free Markdown reader.
Description: Opens .md files as clean, well-laid-out pages, with tabs, folders, search, editing with permission, PDF and Word export, presentation mode, password-locked documents and a File Explorer preview.
Tags:
- markdown
- md
- reader
- viewer
- editor
ReleaseNotesUrl: ${REPO}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: 1.6.0
`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const version = opt('--version') || pkg.version;
  const url = `${REPO}/releases/download/v${version}/NeoMarkdownReader-${version}-Setup.exe`;
  let bytes;
  if (opt('--file')) bytes = readFileSync(opt('--file'));
  else {
    console.log(`Downloading ${url} …`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}). Is v${version} published?`);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const dir = join(root, 'packaging', 'winget', 'manifests', 'n', 'NeoGentrics', 'NeoMarkdownReader', version);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(manifests({ version, sha256, url }))) writeFileSync(join(dir, name), text);
  console.log(`Wrote winget manifests for ${version} (SHA-256 ${sha256}) to ${dir}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.message); process.exit(1); });
