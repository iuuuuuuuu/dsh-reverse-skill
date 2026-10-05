# dsh-reverse-skill

**English** | [简体中文](./README.md)

[![dsh-plugin](https://img.shields.io/badge/dsh--plugin-topic-2f6feb)](https://github.com/topics/dsh-plugin) [![upstream](https://img.shields.io/badge/upstream-zhaoxuya520%2Freverse--skill-informational)](https://github.com/zhaoxuya520/reverse-skill)

A [DSH](https://github.com/deepseek-ai) plugin that exposes the full
[`zhaoxuya520/reverse-skill`](https://github.com/zhaoxuya520/reverse-skill) corpus as a
DSH **skill provider** — 88 skills for reverse engineering, penetration testing, CTF,
malware analysis, mobile/firmware work and security documentation.

It replaces the unmaintained `@dhicoc/dsh-reverse-skill` plugin with a package that
vendors upstream verbatim and re-syncs from it automatically.

## Install

```bash
dsh plugin --profile <profile> add github:iuuuuuuuu/dsh-reverse-skill
```

pnpm resolves the spec to a codeload tarball pinned at a commit, and DSH
registers the plugin because `package.json` declares `dsh.bundle.patch`. No
`pnpm install` is needed first — the repository install pulls its own
dependencies.

Verify the wiring:

```bash
dsh --profile <profile> --dump-config
```

The inserted entry is `reverse-skill-upstream` pointing at `dsh-reverse-skill`.

### Updating

The install is pinned to a commit, so it only moves when you ask:

```bash
dsh plugin --profile <profile> update dsh-reverse-skill
```

That re-resolves the spec against the repository's default branch and rewrites
the lockfile pin. Restart DSH afterwards so the new corpus is scanned.

Two things have to happen before an update carries new skills:

1. The nightly workflow merged its `chore: sync upstream reverse-skill @<commit>`
   pull request, so the repository actually contains the newer corpus.
2. You ran the update command above.

### Other install styles

```bash
# from a local checkout — link: keeps the tree live, so repository edits and
# upstream syncs take effect without repacking or reinstalling
dsh plugin --profile <profile> add link:/absolute/path/to/dsh-reverse-skill
pnpm install   # a link: install needs the checkout's own dependencies

# from a packed tarball
pnpm pack
dsh plugin --profile <profile> add /absolute/path/to/dsh-reverse-skill-<version>.tgz
```

### Replacing the old plugin

```bash
dsh plugin --profile <profile> remove @dhicoc/dsh-reverse-skill
```

Both plugins can coexist: they register different provider names
(`reverse-skill` vs `reverse-skill-upstream`), so nothing collides. Removing the old
one just avoids exposing the same skills twice.

## What gets registered

| | |
|---|---|
| provider name | `reverse-skill-upstream` |
| rank | `600` (bundled tier) |
| scanned roots | `skills/`, `CTF-Sandbox-Orchestrator/` |
| discovery | recursive `SKILL.md` scan |

Unlike DSH's built-in filesystem provider, this provider descends into nested
directories, so layouts such as `skills/pentest-tools/src-hunter/SKILL.md` and
`skills/reverse-engineering/dsl-vm-reverse/SKILL.md` are discovered too. When the same
skill name appears at several depths the shallowest path wins.

Because the rank is `600`, project-level and user-level skills of the same name take
precedence — you can always override a bundled skill locally.

## Syncing with upstream

```bash
pnpm run sync         # mirror upstream, regenerate manifests, bump the patch version
pnpm run sync:check   # report drift only; exits 1 when upstream moved
pnpm run verify       # validate the vendored tree and the plugin manifest
pnpm test             # verify + exercise the provider contract
```

`tools/sync-upstream.mjs` keeps a shallow clone in `.sync-cache/upstream`, mirrors the
vendored trees, deletes files upstream removed, and records:

- `upstream.json` — upstream repository, commit, commit date, upstream `VERSION`
- `tools/upstream-files.json` — per-file SHA-256 so drift is detectable
- `package.json` → `upstreamCommit`, plus an automatic patch bump when content changed

Point it at an existing clone instead of the network with
`node tools/sync-upstream.mjs --upstream /path/to/reverse-skill`.

`.github/workflows/sync-upstream.yml` runs the same script nightly and opens a pull
request when the corpus drifts; nothing is published automatically.

## Layout

```
lib/                        the skill provider (the only code this package adds)
cordis.patch.yml            DSH bundle patch that inserts the plugin
upstream.json               which upstream commit is vendored
tools/                      sync + verification scripts
skills/                     upstream corpus (46 SKILL.md + references/, field-journal/, ...)
CTF-Sandbox-Orchestrator/   upstream CTF corpus (42 SKILL.md + references/)
docs/ examples/ kali/ scripts/ burp-mcp-full/ reports/   upstream supporting trees
UPSTREAM-*.md               upstream READMEs, renamed to avoid clashing with this one
```

Everything except `lib/`, `cordis.patch.yml`, `package.json`, `README.md`, `README.en.md`,
`LICENSE` and `tools/` is upstream content, copied byte for byte. The two upstream trees keep their
original relative positions because skill bodies reference each other by relative path
(for example `skills/ctf-sandbox/SKILL.md` links
`../../CTF-Sandbox-Orchestrator/ctf-sandbox-orchestrator/SKILL.md`).

Upstream `plugins/` (the Codex adapter) is not vendored: its router duplicates
`skills/SKILL.md`, which carries more content.

## First run inside a skill

The upstream corpus expects a generated tool index. Generate it in the installed
package directory before relying on tool paths:

```powershell
# Windows
powershell -NoProfile -ExecutionPolicy Bypass -File skills/scripts/refresh-tool-index.ps1
```

```bash
# Linux / macOS
bash skills/scripts/refresh-tool-index.sh
# Kali
bash kali/scripts/refresh-tool-index.sh
```

`skills/tool-index.md` is intentionally not committed. Upstream scripts resolve their
working root from the current directory, so running a case from your own project keeps
run artifacts (`work/`) out of this package.

## Requirements

- Node.js >= 22
- DSH with the `skills` service (any version — this package declares no
  `@deepseek-ai/dsh*` peer dependency, so it is never gated on an exact DSH release)

## Licensing

MIT. The vendored corpus is `Copyright (c) 2026 zhaoxuya520` (see
[UPSTREAM-LICENSE](./UPSTREAM-LICENSE)); the DSH wrapper is
`Copyright (c) 2026 dsh-reverse-skill contributors` (see [LICENSE](./LICENSE)).