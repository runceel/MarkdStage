# Release process

MarkdStage distributes a canvas Extension installable from GitHub Copilot, an optional Skill, a
standalone npm CLI, and MarkdStage Desktop for Windows x64 and ARM64 from the same repository.

## Versioning and compatibility

1. Use one product version for the Canvas Extension, Skill, npm CLI, and Desktop.
2. Update `packages/markdstage-cli/package.json` to that version before releasing.
3. Review the changes, compatibility, bundled open-source software, and test results.
4. Create one tag in `vMAJOR.MINOR.PATCH` format. That tag identifies every release surface and
   triggers npm publication.
5. Never move a published tag or reuse an npm package version; publish fixes under a new tag.
6. Keep `main` as the path to the latest version, and recommend a tag or commit SHA for reproducible installation.

Migration from the former `presentation` canvas to MarkdStage is a breaking change. The canvas ID,
Extension and Skill paths, guide tool, and Desktop artifact names change, so publish the first
MarkdStage release as a major version.

| Previous | New |
| --- | --- |
| canvas ID `presentation` | canvas ID `MarkdStage` |
| tool `presentation_guide` | tool `markdstage_guide` |
| `.github/extensions/presentation/` | `.github/extensions/markdstage/` |
| `.github/skills/presentation/` | `.github/skills/markdstage/` |
| `Presentation-win-*.zip` | `MarkdStage-win-*.zip` |

Do not provide a compatibility alias for the former canvas ID.

## Extension

The shared manifest is `.github/extensions/markdstage/copilot-extension.json`. Use `markdstage` for
`name`, and update the manifest-format `version` according to the GitHub Copilot App specification
on which it depends.

Distribute the Extension through a folder URL or a ZIP for manual installation.

```text
https://github.com/runceel/markdstage/tree/<tag>/.github/extensions/markdstage
```

Keep the Extension folder free of runtime npm dependencies. Exclude the following development
assets from the distribution ZIP:

- Root `package.json` and `package-lock.json`
- `node_modules/`
- `playwright.config.mjs`
- `.github/workflows/`
- `test/`, `test-results/`, and `playwright-report/`

Include `scripts/` because it handles Markdown persistence, and `schema/` because it contains
user-facing JSON Schemas. Also include the split Mermaid assets and their manifest.

## MarkdStage Desktop

Starting with v4, Desktop ships through Microsoft Store and as signed MSIX packages
in GitHub Releases. The workflow signs x64 and ARM64 packages with the release
certificate and publishes its public `.cer` file so users can trust sideloaded
packages. Run local package validation with your development certificate and
matching publisher:

```powershell
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture x64 -CertificatePath <certificate.pfx> -Publisher <certificate-subject> -Version <major.minor.patch.0>
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture arm64 -CertificatePath <certificate.pfx> -Publisher <certificate-subject> -Version <major.minor.patch.0>
```

Attach the following files to the release:

- `markdstage-markdstage-<version>.tgz`
- `markdstage-markdstage-<version>.tgz.sha256`
- `markdstage-v<version>.zip` (Canvas Extension, not Desktop)
- `markdstage-v<version>.zip.sha256`
- `MarkdStage-win-x64.msix`
- `MarkdStage-win-x64.msix.sha256`
- `MarkdStage-win-arm64.msix`
- `MarkdStage-win-arm64.msix.sha256`
- `MarkdStage.cer`
- `MarkdStage.cer.sha256`

Bundle Windows App SDK and .NET, but no Node runtime. Document WebView2 Runtime and
the packaged CLI's installed-Chromium/remote-debugging requirements in the listing,
installation guide, and release notes. The desktop GUI is a presenter; exports are
CLI-only.

Before the first Store submission, complete the Windows checklist in
`apps/MarkdStage.Desktop/README.md`. Record the external browser's ability to use the
package temporary profile under Store distribution, and verify the embedded
WebView2 script-only `validate` path with no external browser installed. These
measurements cannot be replaced by Linux source tests.

The release workflow is deliberately blocked until these repository variables are
configured for the verified release:

- `MARKDSTAGE_PACKAGE_NAME` and `MARKDSTAGE_PACKAGE_PUBLISHER`: the Partner Center identity.
- `MARKDSTAGE_STORE_URL`: the published `https://apps.microsoft.com/detail/<product-id>` URL.
- `MARKDSTAGE_STORE_ACCEPTED_SHA`: the exact release commit that passed Windows/Store
  acceptance. Do not set it merely because compilation or CI passed.

Configure these GitHub Actions secrets for GitHub Release package signing:

- `MARKDSTAGE_SIGNING_CERTIFICATE_BASE64`: Base64-encoded PFX bytes.
- `MARKDSTAGE_SIGNING_CERTIFICATE_PASSWORD`: password for that PFX.

The certificate subject must exactly match `MARKDSTAGE_PACKAGE_PUBLISHER`. Never
commit the PFX or its password. Only the exported public `.cer` is published.

Create the unsigned multi-architecture package for Partner Center locally after
the release commit is finalized:

```powershell
apps\MarkdStage.Desktop\scripts\CreateStorePackage.ps1 -Version <major.minor.patch.0>
```

This builds x64 and ARM64 packages with the checked-in Store identity and writes
`apps\MarkdStage.Desktop\artifacts\MarkdStage-Store.msixupload`. Upload that file
to Microsoft Store Partner Center. Do not upload the GitHub Release signing
certificate or the signed sideloading packages to Partner Center.

Update both README files to the real Store URL in release preparation, then set the
acceptance SHA after the final release commit is verified. The tag workflow does not
submit to Partner Center automatically. It reads the GitHub Release signing
certificate only from the configured Actions secrets.

The first Store release is the immediate archive cutover, with no parallel archive
publication. The last archive release must announce that it receives no further
updates of any kind; do not amend its notes retroactively after cutover. The first
Store notes and installation guide tell users to install Store, open the same
workspace, and remove the extracted archive folder. State does not migrate; user
Markdown, assets, and themes remain untouched. List parser/title/notes corrections
and the CLI's new explicit-workspace requirement in the compatibility section.

## Validation

```powershell
npm ci
npm test
npm run skills:check
cd packages\markdstage-cli
npm pack --dry-run
cd ..\..
dotnet test apps\MarkdStage.Desktop\tests\MarkdStage.Core.Tests\MarkdStage.Core.Tests.csproj -c Release
dotnet build apps\MarkdStage.Desktop\src\MarkdStage.App\MarkdStage.App.csproj -c Release -r win-x64 -p:Platform=x64
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture x64 -Unsigned -Publisher <package-publisher> -PackageName <package-name>
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture arm64 -Unsigned -Publisher <package-publisher> -PackageName <package-name>
apps\MarkdStage.Desktop\scripts\CreateStorePackage.ps1 -Version <major.minor.patch.0>
```

Then reload the Extension and verify that `MarkdStage` appears in the canvas list,
`markdstage_guide` is available, and Markdown import, navigation, presenter, and PDF export all work
with the new canvas ID.

## MarkdStage CLI on npm

The standalone CLI uses the same semantic version and release tag as the Canvas Extension, Skill,
and Desktop. npm publication authenticates through the configured Trusted Publisher and GitHub
Actions OIDC; do not add a long-lived npm token.

## Prepare the release commit

Before tagging:

1. Update `packages/markdstage-cli/package.json` to the new shared product version.
2. Update every current-release Extension and Desktop URL in `README.md` and `README.ja.md` to use
   the new tag. Do not change historical migration references.
3. Add `.github/release-notes/vMAJOR.MINOR.PATCH.md` with the overview, compatibility statement,
   breaking changes, and migration table described in `.github/release-notes/README.md`.
4. Regenerate Agent Skills if their source changed.
5. Run the validation commands above.
6. Commit and merge all release preparation changes to `main`.

Create and push the shared product tag from the verified `main` commit:

```powershell
git tag v2.3.0
git push origin v2.3.0
```

The tag starts `.github/workflows/npm-publish.yml`. The workflow:

1. Verifies the stable SemVer tag, package version, `main` ancestry, and README links.
2. Runs the complete JavaScript, browser, CLI, accessibility, performance, and PDF test suite.
3. Builds and checksums the Extension ZIP.
4. Tests and builds signed x64 and ARM64 MSIX packages for GitHub Releases.
5. Publishes `@markdstage/markdstage` with npm provenance.
6. Packs and checksums the CLI tarball for offline installation.
7. Generates release notes, creates the GitHub Release, uploads every asset, and verifies the
   published URLs.

The workflow is safe to rerun: existing npm versions are verified instead of republished, and
existing GitHub Release assets are replaced with the newly verified artifacts.

## GitHub Release

The workflow creates the GitHub Release and includes:

- Change summary and verified commit SHA
- Shared Canvas Extension, Skill, npm CLI, and Desktop version
- Breaking changes and migration table
- Supported Windows architectures and the WebView2 Runtime prerequisite
- SHA-256 for the Extension ZIP, CLI tarball, signed MSIX packages, and public certificate
- Updated third-party notices when bundled open-source software changes

## Post-release verification

After the workflow succeeds:

1. Confirm the GitHub Release is marked latest and contains the Extension/CLI
   files, signed x64 and ARM64 MSIX packages, the public signing certificate,
   their checksums, and the Store link.
2. Confirm npm shows the matching `@markdstage/markdstage` version and provenance.
3. Install the version-pinned Extension folder and verify the user-scoped Extension when applicable.
