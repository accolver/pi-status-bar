# Release Checklist

## Lifecycle

- Mode: `full`
- Mode rationale: public package/Git release.
- Escalation: `standard -> full` — externally visible publish and tag.

## Status

`ready` for commit, push, tag, and npm publish after npm authentication.

## Hard gates

- [x] Dependency, package-name collision, and explicitly accepted extension-development advisory are documented in `deps.md`.
- [x] Typecheck, production audit, package dry-run, production-package audit, and `git diff --check` passed.
- [x] No unrelated dirty files existed at task start.
- [x] Package target is `@accolver/pi-status-bar@0.1.1`; tag target is `v0.1.1`.
- [x] Release note scope: scoped npm identity and optional host peer; no behavior change.
- [x] No migration required for existing Git-installed users.
- [x] Rollback: revert the release commit; if published, deprecate `0.1.1` and publish a corrected patch rather than rewriting the tag.
- [x] Owner explicitly approved scoped npm naming, commit, push, npm publication, and Git tags.
- [ ] npm authentication available; `npm whoami` currently returns 401, so npm publication pauses at this gate.

## Validation matrix

| Command/check | Required? | Status | Evidence | Blocker/waiver |
| --- | ---: | --- | --- | --- |
| `npm run check` | yes | passed | strict TypeScript check | none |
| `npm audit --omit=dev --audit-level=low` | yes | passed | zero production advisories | none |
| default `npm audit` | yes | failed | one upstream advisory in the extension's development graph | explicitly accepted by owner intent to minimize issues; no local fix available |
| production tarball install + audit | yes | passed | zero advisories | none |
| `npm pack --dry-run --json` | yes | passed | expected 4 files | none |
| `git diff --check` | yes | passed | no whitespace errors | none |
| repository CI | no | unavailable | no GitHub Actions workflows | not required |
| `npm whoami` | publish | failed | npm 401 | blocks npm publish only |

## Dirty-artifact triage

All changes are release-owned: `README.md`, `package.json`, `package-lock.json`, and this feature evidence directory.

## Release notes

### Changed

- Published under the non-colliding scoped identity `@accolver/pi-status-bar`.
- Marked the Pi coding-agent peer optional so production installs use the host runtime.
- Released patch version `0.1.1`.

### Security

- Production package audit is zero.
- One advisory remains in this extension's development graph until Pi publishes a refreshed shrinkwrap; the separately installed Pi host may expose the same upstream finding and is verified after `pi update --extensions`.

### Migration notes

Existing Git package users require no configuration change. npm users should install `npm:@accolver/pi-status-bar`.
