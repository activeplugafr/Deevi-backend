#!/usr/bin/env node
/**
 * Boots the app just far enough to generate the OpenAPI document and writes
 * it to openapi.json, then exits. The frontend consumes this file, so it is
 * regenerated as part of verification rather than being hand-maintained.
 *
 *   npm run openapi
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ?? join(root, 'openapi.json');

if (!existsSync(join(root, 'dist', 'main.js'))) {
  console.log('  Building first...');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const result = spawnSync('node', ['dist/main.js'], {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, EXPORT_OPENAPI: output, QUEUE_WORKER_ENABLED: 'false' },
});

if (result.status !== 0) process.exit(result.status ?? 1);

if (!existsSync(output)) {
  console.error('  OpenAPI document was not written.');
  process.exit(1);
}

const { size } = statSync(output);
console.log(`\n  OpenAPI written to ${output} (${Math.round(size / 1024)}KB)\n`);
