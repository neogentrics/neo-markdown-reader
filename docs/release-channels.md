# Release channels: Windows signing and winget

Both are built into the Release workflow and both are off. A release behaves exactly as it did until
the settings below exist. They live in the repository under Settings, Secrets and variables, Actions.

## Windows signing with Azure Artifact Signing

Before turning it on:

1. Set up an Artifact Signing account and pass Microsoft's identity check, which takes a few business days.
2. Create a certificate profile, and an app registration with permission to sign.
3. Look at the publisher name on the certificate. An individual account probably shows a legal name, not
   Recon Towers. That name is what people see in the Windows install prompt.

Then add:

| Kind | Name | Value |
|---|---|---|
| Variable | `AZURE_SIGNING_ENDPOINT` | The account's region endpoint. **This one turns signing on.** |
| Variable | `AZURE_SIGNING_ACCOUNT` | The signing account's name |
| Variable | `AZURE_SIGNING_PROFILE` | The certificate profile's name |
| Variable | `AZURE_SIGNING_PUBLISHER` | The publisher name, exactly as it is on the certificate |
| Secret | `AZURE_TENANT_ID` | The Entra tenant |
| Secret | `AZURE_CLIENT_ID` | The app registration |
| Secret | `AZURE_CLIENT_SECRET` | The app registration's secret |

With `AZURE_SIGNING_ENDPOINT` set, the release fails if a Windows file comes out unsigned, so a bad
setting can't quietly publish unsigned builds.

**Be careful with the publisher name.** Signed copies check that each update is signed by the same
publisher. Unsigned copies have nothing to compare, so the first signed release reaches them normally.
After that, a changed publisher name can stop updates for everyone on the old name, so test an update
from the old name to the new one before releasing a change like that.

When signing goes live, also change the Windows steps in the README's install section and tell the
website: `WINDOWS_SIGNED` in `src/lib/store.ts` switches the store's help page.

A `.pfx` certificate still works the old way through `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`.

## winget

Before turning it on:

1. Agree to Microsoft's contributor license on
   [microsoft/winget-pkgs#469811](https://github.com/microsoft/winget-pkgs/pull/469811), or close it and
   start over under a new package id. That pull request is 3.2.0 under `NeoGentrics.NeoMarkdownReader`.
2. Wait for the first submission to merge. Later versions go in as updates to it.

Then add:

| Kind | Name | Value |
|---|---|---|
| Variable | `WINGET_SUBMIT` | `true`. **This one turns submitting on.** |
| Variable | `WINGET_PACKAGE_ID` | Optional. Leave it out to keep `NeoGentrics.NeoMarkdownReader` |
| Secret | `WINGET_TOKEN` | A GitHub token with `public_repo`, from the account that owns the fork of winget-pkgs |

Each release then opens a pull request on microsoft/winget-pkgs after it's published. Microsoft still
reviews each one. If this step fails, the release itself is already out, and the manual way still works:

```bash
node scripts/winget-manifest.mjs
```

When the first version is accepted, set `winget` in the app's `store` block in the website's
`src/lib/projects.ts`, and its page shows the install command.
