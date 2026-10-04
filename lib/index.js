/**
 * dsh-reverse-skill - DSH skill provider for the upstream reverse-skill corpus.
 *
 * The package vendors the upstream repository (github.com/zhaoxuya520/reverse-skill)
 * verbatim under `skills/` and `CTF-Sandbox-Orchestrator/`, so every relative
 * reference inside a skill body (`../references/`, `../field-journal/`,
 * `../tool-index.md`, `../../CTF-Sandbox-Orchestrator/`) keeps resolving.
 *
 * Every `SKILL.md` found anywhere below those two roots is exposed as a skill.
 * Nested layouts that DSH's own filesystem provider cannot see
 * (`skills/pentest-tools/src-hunter/SKILL.md`, `skills/reverse-engineering/dsl-vm-reverse/SKILL.md`)
 * are therefore discovered too.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

/** Absolute path of this package's root directory. */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Provider name registered with the DSH skill registry. */
const PROVIDER_NAME = 'reverse-skill-upstream';

/** Rank of the bundled tier: project and user skills win a name collision. */
const SKILL_RANK = 600;

/** Directories that are scanned recursively for SKILL.md files. */
const SKILL_ROOTS = ['skills', 'CTF-Sandbox-Orchestrator'];

/** Directories never descended into while scanning. */
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.sync-cache', 'plugins', 'work']);

/** File name that marks a skill directory. */
const SKILL_FILE = 'SKILL.md';

/** Same grammar the DSH skill registry enforces. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** @param {string} value */
function toPosix(value) {
  return value.split(sep).join('/');
}

/**
 * Collect every SKILL.md below a root, depth-first, skipping vendored noise.
 * @param {string} root
 * @returns {Promise<Array<{ path: string, depth: number }>>}
 */
async function collectSkillFiles(root) {
  const found = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        stack.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name === SKILL_FILE) {
        found.push({ path: join(current.dir, entry.name), depth: current.depth });
      }
    }
  }
  return found;
}

/**
 * Split a SKILL.md into its YAML frontmatter object and its body.
 * Mirrors dsh-skill-filesystem: the opening fence must be the first line.
 * @param {string} raw
 * @returns {{ data: Record<string, unknown>, body: string } | undefined}
 */
function parseFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  if (lines.length === 0 || lines[0].trim() !== '---') return undefined;
  let closing = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') { closing = index; break; }
  }
  if (closing < 0) return undefined;
  let data;
  try {
    data = parseYaml(lines.slice(1, closing).join('\n'));
  } catch {
    return undefined;
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
  return { data, body: lines.slice(closing + 1).join('\n').trim() };
}

/**
 * Read a boolean frontmatter field, tolerating the quoted "false" spelling
 * the upstream corpus uses inside `metadata`.
 * @param {Record<string, unknown>} data
 * @param {string} key
 * @returns {boolean | undefined}
 */
function readBoolean(data, key) {
  const value = data[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

/**
 * Derive the DSH invocation policy from a skill's frontmatter.
 * Upstream keeps `user-invocable` under `metadata`; DSH only reads the top level,
 * so the nested spelling is promoted here.
 * @param {Record<string, unknown>} data
 * @returns {{ modelInvocable: boolean, userInvocable: boolean }}
 */
function invocationOf(data) {
  const metadata = data.metadata !== null && typeof data.metadata === 'object' && !Array.isArray(data.metadata)
    ? data.metadata
    : {};
  const disableModel = readBoolean(data, 'disable-model-invocation');
  const userInvocable = readBoolean(data, 'user-invocable') !== undefined
    ? readBoolean(data, 'user-invocable')
    : readBoolean(metadata, 'user-invocable');
  return {
    modelInvocable: disableModel !== true,
    userInvocable: userInvocable !== false
  };
}

/**
 * Scan the vendored corpus once and index it by skill name.
 * On a duplicate name the shallower path wins, which keeps the full
 * `skills/SKILL.md` router and drops the Codex adapter copy of it.
 * @returns {Promise<Map<string, { rel: string, abs: string, depth: number, description: string, invocation: { modelInvocable: boolean, userInvocable: boolean }, metadata: Record<string, unknown> }>>}
 */
async function buildIndex() {
  const byName = new Map();
  for (const rootName of SKILL_ROOTS) {
    const root = join(PACKAGE_ROOT, rootName);
    const files = await collectSkillFiles(root);
    for (const file of files) {
      const rel = toPosix(relative(PACKAGE_ROOT, file.path));
      let raw;
      try {
        raw = await readFile(file.path, 'utf8');
      } catch {
        continue;
      }
      const parsed = parseFrontmatter(raw);
      if (parsed === undefined) continue;
      const name = parsed.data.name;
      const description = parsed.data.description;
      if (typeof name !== 'string' || !SKILL_NAME.test(name)) continue;
      if (typeof description !== 'string' || description.trim() === '') continue;
      const previous = byName.get(name);
      const wins = previous === undefined
        || file.depth < previous.depth
        || (file.depth === previous.depth && rel < previous.rel);
      if (!wins) continue;
      byName.set(name, {
        rel,
        abs: file.path,
        depth: file.depth,
        description: description.trim(),
        invocation: invocationOf(parsed.data),
        metadata: parsed.data
      });
    }
  }
  return byName;
}

/** @type {Promise<Map<string, any>> | undefined} */
let indexPromise;

/** @returns {Promise<Map<string, any>>} */
function index() {
  if (indexPromise === undefined) {
    indexPromise = buildIndex().catch((error) => {
      indexPromise = undefined;
      throw error;
    });
  }
  return indexPromise;
}

/**
 * Build the DSH candidate record for one indexed skill.
 * @param {string} name
 * @param {any} entry
 */
function toCandidate(name, entry) {
  return {
    name,
    description: entry.description,
    invocation: { ...entry.invocation },
    source: 'bundled',
    provider: PROVIDER_NAME,
    rank: SKILL_RANK,
    path: entry.rel,
    locator: pathToFileURL(entry.abs),
    resourceBase: { kind: 'directory', path: dirname(entry.abs) },
    metadata: entry.metadata
  };
}

/** Skill provider served to the DSH skill registry. */
const provider = {
  name: PROVIDER_NAME,
  async list() {
    const entries = await index();
    const candidates = [];
    for (const [name, entry] of entries) candidates.push(toCandidate(name, entry));
    return { candidates, complete: true };
  },
  async get(candidate) {
    const entries = await index();
    const entry = entries.get(candidate.name);
    if (entry === undefined) return undefined;
    const raw = await readFile(entry.abs, 'utf8');
    const parsed = parseFrontmatter(raw);
    if (parsed === undefined) return undefined;
    const name = parsed.data.name;
    if (name !== candidate.name) return undefined;
    return {
      ...toCandidate(candidate.name, entry),
      content: parsed.body
    };
  }
};

/** Cordis plugin name. */
export const name = PROVIDER_NAME;

/** Services this plugin depends on. */
export const inject = ['skills'];

/**
 * Register the bundled reverse-skill corpus as a DSH skill provider.
 * @param {{ skills: { registerProvider: (create: () => unknown) => unknown } }} ctx
 */
export function apply(ctx) {
  ctx.skills.registerProvider(() => provider);
}

export { PROVIDER_NAME, SKILL_RANK, SKILL_ROOTS };
