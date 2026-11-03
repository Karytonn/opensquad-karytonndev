import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { containedPath } from '../_opensquad/scripts/runtime.mjs';

export const securityIgnores = ['.env', '.env.*', '!.env.example', '*.bak', '*.tmp',
  '.claude/settings.local.json', '.codex/auth.json', '_opensquad/_browser_profile/',
  '_opensquad/_backups/', '_opensquad/_memory/company.md', '_opensquad/_memory/preferences.md',
  '_opensquad/logs/', 'squads/*/output/'];

export async function mergeSecurityIgnores(targetDir) {
  const file = await containedPath(targetDir, join(targetDir, '.gitignore'));
  let content = '';
  try { content = await readFile(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const lines = content.split(/\r?\n/);
  const missing = securityIgnores.filter(line => !lines.includes(line));
  if (missing.length) await writeFile(file, content + '\n# Opensquad local data\n' + missing.join('\n') + '\n', 'utf8');
}

export async function backupSkill(id, targetDir, skillDir) {
  await containedPath(targetDir, skillDir);
  const backup = await containedPath(targetDir, join(targetDir, '_opensquad', '_backups', 'skills', `${id}-${Date.now()}-${randomUUID()}`));
  await mkdir(dirname(backup), { recursive: true });
  await cp(skillDir, backup, { recursive: true, errorOnExist: true, force: false });
  return backup;
}
