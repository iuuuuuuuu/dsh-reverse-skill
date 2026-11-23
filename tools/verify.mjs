#!/usr/bin/env node
/**
 * Structural verification of the vendored corpus and the plugin manifest.
 * Hard failures exit non-zero; advisory findings print as warnings.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { indexedEntries, isGitCheckout, workingTreeDigests } from './git-objects.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILL_ROOTS = ['skills', 'CTF-Sandbox-Orchestrator'];
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.sync-cache', 'plugins', 'work']);
const failures = [];
const warnings = [];
const toPosix = (value) => value.split(sep).join('/');
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...walk(full));
    } else if (entry.isFile()) files.push(full);
  }
  return files;
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

function parseFrontmatter(raw) {
  const text = stripBom(raw).replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines.length === 0 || lines[0].trim() !== '---') return undefined;
  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') { closing = index; break; }
  }
  if (closing < 0) return undefined;
  let data;
  try { data = parseYaml(lines.slice(1, closing).join('\n')); } catch { return undefined; }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return { data, body: lines.slice(closing + 1).join('\n') };
}

const skills = [];
for (const root of SKILL_ROOTS) {
  const rootPath = join(PACKAGE_ROOT, root);
  if (!existsSync(rootPath)) { fail('missing vendored root: ' + root); continue; }
  for (const file of walk(rootPath)) {
    if (!file.endsWith('SKILL.md')) continue;
    const rel = toPosix(relative(PACKAGE_ROOT, file));
    const parsed = parseFrontmatter(readFileSync(file, 'utf8'));
    if (parsed === undefined) { fail('invalid frontmatter: ' + rel); continue; }
    const name = parsed.data.name;
    const description = parsed.data.description;
    if (typeof name !== 'string' || !SKILL_NAME.test(name)) { fail('invalid skill name in ' + rel + ': ' + String(name)); continue; }
    if (typeof description !== 'string' || description.trim() === '') { fail('missing description in ' + rel); continue; }
    if (parsed.body.trim() === '') { fail('empty body in ' + rel); continue; }
    skills.push({ rel, name, depth: rel.split('/').length });
  }
}

const byName = new Map();
for (const skill of skills) {
  const seen = byName.get(skill.name);
  if (seen === undefined) { byName.set(skill.name, skill); continue; }
  warn('duplicate skill name "' + skill.name + '": ' + seen.rel + ' wins over ' + skill.rel);
}
if (skills.length === 0) fail('no SKILL.md found under ' + SKILL_ROOTS.join(', '));

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
for (const entry of pkg.files || []) {
  if (!existsSync(join(PACKAGE_ROOT, entry))) fail('package.json files[] entry missing on disk: ' + entry);
}
if (!pkg.dsh || !pkg.dsh.bundle || pkg.dsh.bundle.patch !== './cordis.patch.yml') {
  fail('package.json must declare dsh.bundle.patch as ./cordis.patch.yml');
}
for (const key of Object.keys(pkg.peerDependencies || {})) {
  if (key === '@deepseek-ai/dsh' || key.indexOf('@deepseek-ai/dsh-') === 0) {
    fail('peerDependencies[' + key + '] would gate installation on a DSH version; keep DSH peers out of package.json');
  }
}

// The Chinese README is the default document and the English one is its
// translation; both must stay cross-linked and both must ship in the package,
// otherwise the default README links to a file that is not published.
const readmeFile = join(PACKAGE_ROOT, 'README.md');
const readmeEnFile = join(PACKAGE_ROOT, 'README.en.md');
if (!existsSync(readmeFile)) fail('README.md is missing');
if (!existsSync(readmeEnFile)) fail('README.en.md is missing');
if ((pkg.files || []).indexOf('README.en.md') === -1) {
  fail('package.json files[] must publish README.en.md, because README.md links to it');
}
if (existsSync(readmeFile) && existsSync(readmeEnFile)) {
  const readme = readFileSync(readmeFile, 'utf8');
  const readmeEn = readFileSync(readmeEnFile, 'utf8');
  if (readme.indexOf('./README.en.md') === -1) fail('README.md must link to ./README.en.md');
  if (readmeEn.indexOf('./README.md') === -1) fail('README.en.md must link back to ./README.md');
  if (readme.indexOf('安装') === -1) fail('README.md is the default document and must be written in Chinese');
}
const patchFile = join(PACKAGE_ROOT, 'cordis.patch.yml');
if (!existsSync(patchFile)) fail('cordis.patch.yml is missing');
else {
  let patch;
  try { patch = parseYaml(readFileSync(patchFile, 'utf8')); }
  catch (error) { fail('cordis.patch.yml is not valid YAML: ' + error.message); }
  if (patch !== undefined) {
    if (!Array.isArray(patch)) fail('cordis.patch.yml must be a YAML array of patch entries');
    else {
      const inserts = patch.flatMap((entry) => (entry && Array.isArray(entry.insert) ? entry.insert : []));
      const names = inserts.map((row) => row && row.name);
      if (!names.includes(pkg.name)) {
        fail('cordis.patch.yml insert must name the package ' + pkg.name + ', found ' + JSON.stringify(names));
      }
    }
  }
}

const upstreamFile = join(PACKAGE_ROOT, 'upstream.json');
const manifestFile = join(PACKAGE_ROOT, 'tools', 'upstream-files.json');
if (!existsSync(upstreamFile)) warn('upstream.json is missing; run npm run sync');
else if (!existsSync(manifestFile)) warn('tools/upstream-files.json is missing; run npm run sync');
else {
  const upstream = JSON.parse(readFileSync(upstreamFile, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (upstream.commit !== manifest.commit) fail('upstream.json and tools/upstream-files.json disagree on the upstream commit');
  if (pkg.upstreamCommit !== upstream.commit) fail('package.json upstreamCommit does not match upstream.json');
  if (upstream.vendoredFiles !== Object.keys(manifest.files || {}).length) {
    fail('upstream.json vendoredFiles does not match tools/upstream-files.json');
  }
  // The manifest records what upstream committed, so the working tree must
  // reproduce those digests. Digests are taken through git's clean filters, so
  // this stays meaningful on a checkout whose line endings were rewritten.
  //
  // Reading the index here instead used to look equivalent and was not: right
  // after a sync the mirrored files are not staged, so every drifted file was
  // compared against its previous committed blob and the nightly job failed on
  // precisely the drift it exists to validate. The working tree is the thing
  // the pull request will commit, so that is what gets checked.
  const recorded = manifest.files || {};
  const keys = Object.keys(recorded).sort();
  const present = [];
  for (const key of keys) {
    if (existsSync(join(PACKAGE_ROOT, key))) present.push(key);
    else fail('vendored file is recorded but missing from the working tree: ' + key);
  }
  if (isGitCheckout(PACKAGE_ROOT)) {
    let digests;
    try {
      digests = workingTreeDigests(PACKAGE_ROOT, present);
    } catch (error) {
      fail('could not hash the vendored tree: ' + error.message);
    }
    if (digests !== undefined) {
      const drifted = present.filter((key) => digests.get(key) !== recorded[key]);
      if (drifted.length > 0) {
        fail('vendored content does not match tools/upstream-files.json: ' + drifted.slice(0, 10).join(', '));
      }
    }
  } else {
    warn('not a git checkout; skipping vendored content check');
  }

  // Git records an executable bit in the tree that some filesystems cannot
  // represent, so a Windows checkout silently loses it. Where the bit is
  // observable it is checked on the thing a commit would record: the index for
  // a tracked file, the filesystem for an untracked one on a platform that can
  // represent it. On Windows an untracked file has no observable bit at all, so
  // that case is reported rather than guessed at.
  const executable = manifest.executable || [];
  if (executable.length > 0) {
    let index;
    try {
      index = indexedEntries(PACKAGE_ROOT);
    } catch {
      warn('could not read the git index; skipping executable-bit check');
    }
    const unobservable = [];
    const demoted = [];
    for (const key of executable) {
      if (!existsSync(join(PACKAGE_ROOT, key))) continue;
      const entry = index === undefined ? undefined : index.get(key);
      if (entry !== undefined) {
        if (entry.mode !== '100755') demoted.push(key);
      } else if (process.platform === 'win32') {
        unobservable.push(key);
      } else {
        try {
          if ((statSync(join(PACKAGE_ROOT, key)).mode & 0o111) === 0) demoted.push(key);
        } catch {
          demoted.push(key);
        }
      }
    }
    if (demoted.length > 0) {
      fail('vendored files should be executable but are recorded without the bit: ' + demoted.slice(0, 10).join(', '));
    }
    if (unobservable.length > 0) {
      warn('cannot observe the executable bit of untracked files on Windows: ' + unobservable.slice(0, 10).join(', '));
    }
  }
}

const REFERENCE = /\]\(([^)\s]+\.(?:md|ps1|sh|py|json|ya?ml|txt))\)/g;
let unresolved = 0;
for (const skill of skills) {
  const body = readFileSync(join(PACKAGE_ROOT, skill.rel), 'utf8');
  const base = dirname(join(PACKAGE_ROOT, skill.rel));
  for (const match of body.matchAll(REFERENCE)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    if (target.indexOf('{') !== -1 || target.indexOf('*') !== -1) continue;
    const candidates = [
      resolve(base, target),
      resolve(PACKAGE_ROOT, target),
      resolve(PACKAGE_ROOT, 'skills', target)
    ];
    if (!candidates.some((candidate) => existsSync(candidate))) {
      unresolved += 1;
      if (unresolved <= 15) warn('unresolved reference in ' + skill.rel + ': ' + target);
    }
  }
}
if (unresolved > 15) warn('... and ' + (unresolved - 15) + ' more unresolved references');

console.log(JSON.stringify({
  skills: skills.length,
  uniqueNames: byName.size,
  vendoredRoots: SKILL_ROOTS,
  warnings: warnings.length,
  failures: failures.length
}, null, 2));
for (const message of warnings) console.log('warning: ' + message);
for (const message of failures) console.error('error: ' + message);
if (failures.length > 0) process.exitCode = 1;
