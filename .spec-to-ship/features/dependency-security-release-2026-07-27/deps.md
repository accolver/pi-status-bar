# Dependency Decision

## Lifecycle

- Mode: `full`
- Mode rationale: dependency security maintenance, npm package-name correction, and public release.
- Escalation: `standard -> full` — publishing and tagging are externally visible.

## Proposed change

Mark the Pi coding-agent peer optional, adopt the available scoped npm name `@accolver/pi-status-bar`, refresh npm metadata, and release `0.1.1`.

## Dependency type

Dev dependencies and host-provided peer dependencies; no new runtime dependency.

## Reason

Prevent production installs from redundantly installing the Pi host graph and avoid collision with the unrelated public `pi-status-bar@1.0.0` owned by `earendil-works`.

## Existing alternatives

Publishing under the existing unscoped name is impossible because it belongs to another maintainer. The owner explicitly approved `@accolver/pi-status-bar`. An npm root override for `brace-expansion@5.0.8` was tested and rejected as ineffective against the upstream Pi package shrinkwrap.

## Standard-library or no-dependency alternative

Not applicable. The extension consumes host-provided Pi type APIs.

## License result

Allow. Direct packages retain existing MIT/Apache-compatible licenses; no new dependency was added.

## Maintenance evidence

Registry checks on 2026-07-27 showed direct dependencies current: Pi packages `0.82.1` and TypeScript `7.0.2`. `npm outdated --json` returned no outdated direct dependency.

## Vulnerability/provenance evidence

- `npm audit --omit=dev --audit-level=low`: zero vulnerabilities.
- Packed production install followed by `npm audit --omit=dev`: zero vulnerabilities.
- Default development audit: one high transitive advisory, GHSA-mh99-v99m-4gvg, from `@earendil-works/pi-coding-agent@0.82.1 -> minimatch@10.2.5 -> brace-expansion@5.0.7`.
- The residual is pinned by the upstream published shrinkwrap and cannot be corrected locally without replacing or patching the current Pi development package. This bounds only the extension artifact; the separately installed Pi host may retain the same upstream finding.
- The scoped package identity is new and explicitly owner-approved, reducing name-collision risk.

## Size/runtime impact

Production dependency footprint decreases because Pi host peers are optional. The packed extension remains source-only.

## Lockfile/package-manager behavior

npm 11.13.0 updated `package-lock.json` for scoped identity, version, and optional-peer metadata. Direct versions remain current.

## Decision

Publish as `@accolver/pi-status-bar@0.1.1` and accept the bounded advisory in this extension's development graph while the extension's production artifact audits remain zero.

## Residual risk and follow-up

Upgrade `@earendil-works/pi-coding-agent` when an upstream release refreshes its shrinkwrap to `brace-expansion >=5.0.8`, then rerun default `npm audit`.
