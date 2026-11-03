import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sections = ['Estilo de Escrita', 'Design Visual', 'Estrutura de Conteúdo',
  'Proibições Explícitas', 'Técnico (específico do squad)'];

export function validateSquadCode(code) {
  if (typeof code !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
    throw new Error('Invalid squad code');
  }
}

// Canonicalize the selected root (including Windows short names/case aliases),
// then reject traversal and symlinks/junctions below that root.
export async function containedPath(root, target) {
  root = resolve(root);
  target = resolve(target);
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path outside allowed directory');
  try { root = await realpath(root); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  target = resolve(root, rel);
  let current = root;
  for (const part of ['', ...rel.split(sep).filter(Boolean)]) {
    current = part ? join(current, part) : current;
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('Symlinks and junctions are not allowed');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return target;
}

async function squadRoot(projectRoot, code) {
  validateSquadCode(code);
  return containedPath(projectRoot, join(projectRoot, 'squads', code));
}

export async function migrateMemory(projectRoot, code) {
  const root = await squadRoot(projectRoot, code);
  const file = await containedPath(root, join(root, '_memory', 'memories.md'));
  let old = '';
  let exists = true;
  try { old = await readFile(file, 'utf8'); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    exists = false;
  }
  const missing = sections.filter(s => !old.split(/\r?\n/).includes(`## ${s}`));
  let backup = null;
  if (!exists || missing.length) {
    await mkdir(dirname(file), { recursive: true });
    if (exists) {
      backup = `${file}.${Date.now()}-${randomUUID()}.bak`;
      await copyFile(file, backup, constants.COPYFILE_EXCL);
    }
    const content = (exists ? old : `# Squad Memory: ${code}`) +
      '\n\n' + missing.map(s => `## ${s}\n`).join('\n');
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, file);
  }
  const history = await containedPath(root, join(root, '_memory', 'runs.md'));
  try {
    await writeFile(history, `# Run History: ${code}\n\n| Data | Run ID | Tema | Output | Resultado |\n|------|--------|------|--------|-----------|\n`, { flag: 'wx' });
  } catch (err) { if (err.code !== 'EEXIST') throw err; }
  return { migrated: !exists || missing.length > 0, backup };
}

export async function resolveInput(projectRoot, code, runId, declaredPath) {
  const root = await squadRoot(projectRoot, code);
  if (!/^\d{4}-\d{2}-\d{2}-\d{6}(?:-\d+)?$/.test(runId)) throw new Error('Invalid run ID');
  const prefix = `squads/${code}/output/`;
  const normalized = declaredPath.replaceAll('\\', '/');
  if (!normalized.startsWith(prefix) || normalized.split('/').some(p => p === '..' || p === '.')) {
    throw new Error('Input must be inside the squad output directory');
  }
  const runRoot = await containedPath(root, join(root, 'output', runId));
  const candidate = await containedPath(runRoot, join(runRoot, normalized.slice(prefix.length)));
  const parent = dirname(candidate);
  const name = candidate.slice(parent.length + 1);
  // Versioned agent outputs take precedence; checkpoint files are unversioned.
  let versions = [];
  try { versions = (await readdir(parent)).filter(n => /^v[1-9]\d*$/.test(n)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  for (const p of [...versions.map(v => join(parent, v, name)), candidate]) {
    await containedPath(runRoot, p);
    try {
      const info = await lstat(p);
      if (info.isFile() && info.size > 0) return p;
    } catch (err) { if (err.code !== 'ENOENT') throw err; }
  }
  throw new Error('Non-empty input file not found in this run');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, code, runId, declared] = process.argv.slice(2);
    if (command === 'migrate-memory') console.log(JSON.stringify(await migrateMemory(process.cwd(), code)));
    else if (command === 'resolve-input') console.log(await resolveInput(process.cwd(), code, runId, declared));
    else throw new Error('Use migrate-memory <squad> or resolve-input <squad> <run-id> <path>');
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
