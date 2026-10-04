#!/usr/bin/env node
/**
 * Read exact object bytes out of a git object store.
 *
 * A checkout with core.autocrlf rewrites line endings in the working copy, so
 * hashing files on disk makes any digest platform dependent: a Windows machine
 * and a Linux CI runner would disagree about the same commit. Reading objects
 * instead keeps the digests byte-identical everywhere, which is what lets the
 * nightly sync job stay quiet when nothing upstream actually changed.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 512 * 1024 * 1024;

/**
 * SHA-256 of the bytes git stores for each revision spec, keyed by spec.
 * Specs are anything `git cat-file` accepts, such as `HEAD:path` or a raw
 * object id. Throws when the repository has no such object.
 */
export function digestObjects(cwd, specs) {
  const digests = new Map();
  if (specs.length === 0) return digests;
  const raw = execFileSync('git', ['cat-file', '--batch'], {
    cwd,
    input: specs.join(String.fromCharCode(10)) + String.fromCharCode(10),
    maxBuffer: MAX_BUFFER
  });
  let offset = 0;
  for (const spec of specs) {
    const headerEnd = raw.indexOf(0x0a, offset);
    if (headerEnd === -1) throw new Error('unexpected git cat-file output while reading ' + spec);
    const header = raw.subarray(offset, headerEnd).toString('utf8').split(' ');
    if (header.length !== 3) throw new Error('git has no object for ' + spec);
    const size = Number.parseInt(header[2], 10);
    const start = headerEnd + 1;
    digests.set(spec, createHash('sha256').update(raw.subarray(start, start + size)).digest('hex'));
    offset = start + size + 1;
  }
  return digests;
}

/** Whether a directory is inside a git working tree. */
export function isGitCheckout(directory) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: directory, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Map of path -> { mode, sha } for everything tracked at a revision. */
export function trackedEntries(cwd, revision = 'HEAD') {
  const raw = execFileSync('git', ['ls-tree', '-r', '-z', revision], { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  const entries = new Map();
  for (const record of raw.split(String.fromCharCode(0))) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const fields = record.slice(0, tab).split(' ');
    entries.set(record.slice(tab + 1), { mode: fields[0], sha: fields[2] });
  }
  return entries;
}

/** Map of path -> { mode, sha } for the current index. */
export function indexedEntries(cwd) {
  const raw = execFileSync('git', ['ls-files', '-s', '-z'], { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  const entries = new Map();
  for (const record of raw.split(String.fromCharCode(0))) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const fields = record.slice(0, tab).split(' ');
    entries.set(record.slice(tab + 1), { mode: fields[0], sha: fields[1] });
  }
  return entries;
}
