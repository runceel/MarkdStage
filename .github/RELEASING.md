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

### Awesome Copilot external plugin

The awesome-copilot submission layout is generated under `.github/plugin/markdstage/` from the
canonical Extension source. Keep normal development in `.github/extensions/markdstage/`; do not
maintain a second hand-edited implementation. After changing the Extension, regenerate the
committed tree:

```powershell
npm run awesome:sync
```

Verification is separate and never writes:

```powershell
npm run awesome:check
```

This compares the committed tree byte-for-byte against freshly generated output and verifies the
Agent Plugins manifest, the `canvas` keyword, `assets/preview.png`, the
`com.github.copilot/extensions/markdstage/extension.mjs` entry point, the absence of the
Extension test tree and of npm dependencies, the vendor manifest, and product-version alignment
with the CLI package. CI runs it through the `Awesome Copilot plugin` job, and the release
`validate` job runs it before a tag is accepted, so a stale plugin tree blocks the release.

Do not update the awesome-copilot marketplace directly from this repository and do not create
an awesome-copilot submission Issue as part of the release. If the project is later submitted
or updated by a maintainer, use the new product tag and its full commit SHA as immutable source
locators. Small changes may remain on `main` and be grouped into the next publication; security,
installation, startup, or data-integrity fixes should be prioritized for the next update.

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

Starting with v4, Desktop is distributed through GitHub Releases as portable Windows
packages and signed sideloading MSIX packages. The workflow signs x64 and ARM64 MSIX
packages with the release certificate and publishes its public `.cer` file so users
can trust sideloaded packages. Microsoft Store submission is a separate local
Partner Center operation.

```powershell
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture x64 -Format Archive
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture arm64 -Format Archive
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture x64 -CertificatePath <certificate.pfx> -Publisher <certificate-subject> -Version <major.minor.patch.0>
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture arm64 -CertificatePath <certificate.pfx> -Publisher <certificate-subject> -Version <major.minor.patch.0>
```

Attach the following files to the release:

- `markdstage-markdstage-<version>.tgz`
- `markdstage-markdstage-<version>.tgz.sha256`
- `markdstage-v<version>.zip` (Canvas Extension, not Desktop)
- `markdstage-v<version>.zip.sha256`
- `MarkdStage-win-x64.zip`
- `MarkdStage-win-x64.zip.sha256`
- `MarkdStage-win-arm64.zip`
- `MarkdStage-win-arm64.zip.sha256`
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

The release workflow reads the package Identity Name and Publisher from the
Store-associated `apps/MarkdStage.Desktop/src/MarkdStage.App/Package.appxmanifest`.
Do not duplicate them in repository variables. The signing certificate Subject
must exactly match the manifest Publisher.

Configure these GitHub Actions secrets for GitHub Release package signing:

- `MARKDSTAGE_SIGNING_CERTIFICATE_BASE64`: Base64-encoded PFX bytes.
- `MARKDSTAGE_SIGNING_CERTIFICATE_PASSWORD`: password for that PFX.

Never commit the PFX or its password. Only the exported public `.cer` is published.

Create the unsigned multi-architecture package for Partner Center locally as the
final release step, after the GitHub Release and npm publication are verified:

```powershell
apps\MarkdStage.Desktop\scripts\CreateStorePackage.ps1 -Version <major.minor.patch.0>
```

This builds x64 and ARM64 packages with the checked-in Store identity and writes
`apps\MarkdStage.Desktop\artifacts\MarkdStage-Store-<version>.msixupload` and its SHA-256
checksum. A requested release is not complete until these local files have been
generated and verified. Report their full paths when handing off the completed
release.

Upload the `.msixupload` file to Microsoft Store Partner Center only when
submission is explicitly requested. Do not upload the GitHub Release signing
certificate or the signed sideloading packages to Partner Center.

The Partner Center listing text, screenshots, and Store art are maintained in
`.github/store/`. Update `.github/store/listing-en-us.md` before editing the
listing in Partner Center, and see `.github/store/README.md` for the asset
inventory and regeneration commands.

Store availability, the Store URL, and Store acceptance status are not prerequisites
for a GitHub Release. After the GitHub Release is verified, create the local
`.msixupload` package. Partner Center upload and submission remain separate,
explicit operations. Do not describe Store cutover or archive retirement in GitHub
Release notes until the Store listing is actually published.

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
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture x64 -Unsigned
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture arm64 -Unsigned
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture x64 -Format Archive
apps\MarkdStage.Desktop\scripts\Publish.ps1 -Architecture arm64 -Format Archive
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

1. Verifies the stable SemVer tag, package version, `main` ancestry, README links, and a successful
   `CI` workflow run for the exact tagged commit.
2. Builds and checksums the Extension ZIP.
3. Tests and builds x64 and ARM64 portable Windows packages plus signed x64 and ARM64 MSIX packages for GitHub Releases.
4. Publishes `@markdstage/markdstage` with npm provenance.
5. Packs and checksums the CLI tarball for offline installation.
6. Generates release notes, creates the GitHub Release, uploads every asset, and verifies the
   published URLs.

The workflow is safe to rerun: existing npm versions are verified instead of republished, and
existing GitHub Release assets are replaced with the newly verified artifacts.
The complete JavaScript, browser, CLI, Desktop, accessibility, performance, PDF, and PowerPoint
test suites run once in `ci.yml`; the release workflow does not repeat them.

## GitHub Release

The workflow creates the GitHub Release and includes:

- Change summary and verified commit SHA
- Shared Canvas Extension, Skill, npm CLI, and Desktop version
- Breaking changes and migration table
- Supported Windows architectures and the WebView2 Runtime prerequisite
- SHA-256 for the Extension ZIP, CLI tarball, portable Windows packages, signed MSIX packages, and public certificate
- Updated third-party notices when bundled open-source software changes

## Post-release verification

After the workflow succeeds:

1. Confirm the GitHub Release is marked latest and contains the Extension/CLI
   files, x64 and ARM64 portable Windows packages, signed x64 and ARM64 MSIX
   packages, the public signing certificate, and their checksums.
2. Confirm npm shows the matching `@markdstage/markdstage` version and provenance.
3. Install the version-pinned Extension folder and verify the user-scoped Extension when applicable.
4. As the final release step, create the local Partner Center upload package using
   the released version:

   ```powershell
   apps\MarkdStage.Desktop\scripts\CreateStorePackage.ps1 -Version <major.minor.patch.0>
   ```

5. Confirm both files exist and report their full paths:
   - `apps\MarkdStage.Desktop\artifacts\MarkdStage-Store-<version>.msixupload`
   - `apps\MarkdStage.Desktop\artifacts\MarkdStage-Store-<version>.msixupload.sha256`

Do not consider a requested release complete until step 5 succeeds. Creating the
package does not submit it to Partner Center.
