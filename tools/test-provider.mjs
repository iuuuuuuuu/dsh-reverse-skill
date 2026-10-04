#!/usr/bin/env node
/**
 * Exercise the plugin skill provider against the DSH registry contract:
 * provider identity, candidate validation, unique names, and retrieval.
 */
import { strict as assert } from 'node:assert';
import { apply, name, inject } from '../lib/index.js';

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

let registered;
const ctx = {
  skills: {
    registerProvider(create) {
      registered = create();
      return () => {};
    }
  }
};

apply(ctx);
assert.ok(registered, 'apply() must register a provider');
assert.equal(name, registered.name, 'plugin name must equal provider name');
assert.deepEqual(inject, ['skills']);
assert.ok(registered.name !== 'runtime', 'provider name must not be reserved');

const observation = await registered.list();
assert.ok(observation && Array.isArray(observation.candidates), 'list() must return candidates');
assert.equal(observation.complete, true, 'complete must be true so the catalog is published');
assert.ok(observation.candidates.length > 0, 'provider must expose skills');

const seen = new Set();
for (const candidate of observation.candidates) {
  assert.equal(typeof candidate.name, 'string');
  assert.ok(SKILL_NAME.test(candidate.name), 'invalid skill name: ' + candidate.name);
  assert.equal(typeof candidate.description, 'string');
  assert.ok(candidate.description.trim() !== '', 'empty description: ' + candidate.name);
  assert.equal(typeof candidate.invocation.modelInvocable, 'boolean');
  assert.equal(typeof candidate.invocation.userInvocable, 'boolean');
  assert.equal(candidate.source, 'bundled');
  assert.equal(candidate.provider, registered.name, 'candidate.provider must equal provider.name');
  assert.equal(typeof candidate.rank, 'number');
  assert.ok(Number.isFinite(candidate.rank));
  assert.ok(candidate.resourceBase && candidate.resourceBase.kind === 'directory');
  assert.ok(!seen.has(candidate.name), 'duplicate candidate name: ' + candidate.name);
  seen.add(candidate.name);
}

for (const candidate of observation.candidates) {
  const definition = await registered.get(candidate);
  assert.ok(definition, 'get() returned nothing for ' + candidate.name);
  assert.equal(definition.name, candidate.name, 'get() must echo the candidate name');
  assert.equal(typeof definition.content, 'string');
  assert.ok(definition.content.trim() !== '', 'empty content for ' + candidate.name);
  assert.ok(definition.content.slice(0, 3) !== '---', 'content must exclude frontmatter: ' + candidate.name);
}

const missing = await registered.get({ name: 'this-skill-does-not-exist' });
assert.equal(missing, undefined, 'unknown names must resolve to undefined');

console.log(JSON.stringify({
  provider: registered.name,
  skills: observation.candidates.length,
  sample: observation.candidates.slice(0, 3).map((candidate) => candidate.name)
}, null, 2));
