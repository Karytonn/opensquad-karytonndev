import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containedPath, migrateMemory, resolveInput } from '../_opensquad/scripts/runtime.mjs';
import { main, readValidatedImage, createChildContainer } from '../skills/instagram-publisher/scripts/publish.js';
import { installSkill } from '../src/skills.js';
import { mergeSecurityIgnores } from '../src/security.js';
import { update } from '../src/update.js';

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'opensquad-security-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('memory migration preserves exact legacy text, backups and run history; rerun is idempotent', async t => {
  const dir = await workspace(t);
  const folder = join(dir, 'squads', 'demo', '_memory');
  await mkdir(folder, { recursive: true });
  const original = '# Memória\n\nNão publicar dados de clientes.\n';
  await writeFile(join(folder, 'memories.md'), original);
  await writeFile(join(folder, 'runs.md'), 'existing history');
  const result = await migrateMemory(dir, 'demo');
  assert.equal(await readFile(result.backup, 'utf8'), original);
  const after = await readFile(join(folder, 'memories.md'), 'utf8');
  assert.ok(after.startsWith(original));
  assert.equal(await readFile(join(folder, 'runs.md'), 'utf8'), 'existing history');
  assert.equal((await migrateMemory(dir, 'demo')).migrated, false);
  assert.equal(await readFile(join(folder, 'memories.md'), 'utf8'), after);
});

test('input resolution selects newest non-empty version only in current run and rejects traversal', async t => {
  const dir = await workspace(t);
  const run = '2026-11-03-120000';
  const base = join(dir, 'squads', 'demo', 'output', run);
  for (const v of ['v1', 'v2', 'v10']) await mkdir(join(base, v), { recursive: true });
  await writeFile(join(base, 'v1', 'draft.md'), 'old');
  await writeFile(join(base, 'v2', 'draft.md'), 'new');
  await writeFile(join(base, 'v10', 'draft.md'), '');
  await writeFile(join(base, 'focus.md'), 'checkpoint');
  assert.equal(await resolveInput(dir, 'demo', run, 'squads/demo/output/draft.md'), await realpath(join(base, 'v2', 'draft.md')));
  assert.equal(await resolveInput(dir, 'demo', run, 'squads/demo/output/focus.md'), await realpath(join(base, 'focus.md')));
  await assert.rejects(resolveInput(dir, '../other', run, 'x'));
  await assert.rejects(resolveInput(dir, 'demo', run, 'squads/demo/output/../../secret'));
  await assert.rejects(resolveInput(dir, 'demo', run, 'C:/secret'));
  await assert.rejects(resolveInput(dir, 'demo', run, 'squads/demo/output/missing.md'));
});

test('Windows path aliases resolve to the same root without weakening containment', { skip: process.platform !== 'win32' }, async t => {
  const dir = await workspace(t);
  assert.equal(await containedPath(dir.toUpperCase(), join(dir.toUpperCase(), 'new.txt')), join(await realpath(dir), 'new.txt'));
  await assert.rejects(containedPath(dir, join(dir, '..', 'outside.txt')));
});

test('offline dry-run works without credentials or any network access; wrong modes cannot upload', async t => {
  const dir = await workspace(t);
  const images = [join(dir, 'a.jpg'), join(dir, 'b.jpeg')];
  for (const image of images) await writeFile(image, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Network must not be accessed'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const args = ['node', 'publisher', '--images', images.join(','), '--images-root', dir, '--caption', 'Preview'];
  await main([...args, '--dry-run']);
  await assert.rejects(main(args), /exactly one mode/);
  await assert.rejects(main([...args, '--publish']), /allow-public-upload/);
  await assert.rejects(main([...args, '--integration-test']), /allow-public-upload/);
  await assert.rejects(main([...args, '--dry-run', '--publish']), /exactly one mode/);
});

test('image upload validation rejects other files and symlinks escaping the image root', async t => {
  const dir = await workspace(t);
  const root = join(dir, 'images');
  await mkdir(root);
  await writeFile(join(root, 'secret.jpg'), 'not an image');
  assert.throws(() => readValidatedImage(join(root, 'secret.jpg'), root), /signature/);
  const outside = join(dir, 'outside.jpg');
  await writeFile(outside, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  assert.throws(() => readValidatedImage(outside, root), /inside/);
  try { await symlink(outside, join(root, 'link.jpg')); }
  catch (err) { if (err.code === 'EPERM') return; throw err; }
  assert.throws(() => readValidatedImage(join(root, 'link.jpg'), root), /inside/);
});

test('Graph token is sent as a header, never in URL or form body', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.ok(!String(url).includes('test-secret'));
    assert.ok(!String(options.body).includes('test-secret'));
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    return { ok: true, json: async () => ({ id: '123' }) };
  };
  assert.equal(await createChildContainer('123', 'https://example.invalid/image.jpg', 'test-secret'), '123');
});

test('skill replacement backs up local changes and ignore merging retains user entries', async t => {
  const dir = await workspace(t);
  await mkdir(join(dir, 'skills', 'instagram-publisher'), { recursive: true });
  await writeFile(join(dir, 'skills', 'instagram-publisher', 'SKILL.md'), 'local customization');
  await installSkill('instagram-publisher', dir);
  const backups = join(dir, '_opensquad', '_backups', 'skills');
  const entries = await readdir(backups);
  assert.equal(await readFile(join(backups, entries[0], 'SKILL.md'), 'utf8'), 'local customization');
  await writeFile(join(dir, '.gitignore'), 'my-private-data/\n');
  await mergeSecurityIgnores(dir);
  const ignore = await readFile(join(dir, '.gitignore'), 'utf8');
  assert.ok(ignore.startsWith('my-private-data/\n'));
  assert.ok(ignore.includes('_opensquad/_browser_profile/'));
  await mergeSecurityIgnores(dir);
  assert.equal(await readFile(join(dir, '.gitignore'), 'utf8'), ignore);
});

test('update --skills distributes viewer fixes and runtime while preserving configs, company and custom skills', async t => {
  const dir = await workspace(t);
  const savedLog = console.log;
  console.log = () => {};
  t.after(() => { console.log = savedLog; });
  await mkdir(join(dir, '_opensquad', '_memory'), { recursive: true });
  await writeFile(join(dir, '_opensquad', '_memory', 'company.md'), 'private company');
  await mkdir(join(dir, 'skills', 'opensquad-skill-creator'), { recursive: true });
  await writeFile(join(dir, 'skills', 'opensquad-skill-creator', 'SKILL.md'), 'legacy viewer');
  await mkdir(join(dir, 'skills', 'custom'), { recursive: true });
  await writeFile(join(dir, 'skills', 'custom', 'SKILL.md'), 'user custom skill');
  await writeFile(join(dir, '.mcp.json'), '{"mcpServers":{"custom":{}}}');
  await writeFile(join(dir, '.gitignore'), 'user-ignore/\n');
  await update(dir, { refreshSkills: true });
  assert.equal(await readFile(join(dir, '.mcp.json'), 'utf8'), '{"mcpServers":{"custom":{}}}');
  assert.equal(await readFile(join(dir, '_opensquad', '_memory', 'company.md'), 'utf8'), 'private company');
  assert.equal(await readFile(join(dir, 'skills', 'custom', 'SKILL.md'), 'utf8'), 'user custom skill');
  assert.ok((await readFile(join(dir, '.gitignore'), 'utf8')).startsWith('user-ignore/'));
  assert.ok((await readFile(join(dir, 'skills', 'opensquad-skill-creator', 'eval-viewer', 'generate_review.py'), 'utf8')).includes('csrf_token'));
  assert.ok((await readFile(join(dir, '_opensquad', 'scripts', 'runtime.mjs'), 'utf8')).includes('migrateMemory'));
});
