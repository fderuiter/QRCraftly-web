#!/usr/bin/env node
/**
 * scripts/write_build_info.js
 *
 * Writes dist/client/version.json so that a deployed environment reports which
 * release and commit it is serving. Release and staging smoke tests poll this file
 * to wait for Cloudflare Workers Builds to finish deploying before they run.
 *
 * The file is never precached: the service worker's shell holds only the homepage and what it
 * loads (scripts/generate_sw.cjs).
 * Contains only public build metadata (package version and commit SHA).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execBinary } from './utils/execHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist', 'client');

/**
 * Resolves the commit being built. Workers Builds exposes WORKERS_CI_COMMIT_SHA,
 * GitHub Actions exposes GITHUB_SHA, and local builds fall back to git.
 *
 * @returns {string}
 */
function resolveCommit(env = process.env) {
  const fromEnv = env.WORKERS_CI_COMMIT_SHA || env.GITHUB_SHA;
  if (fromEnv) return fromEnv.trim();
  try {
    return execBinary('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).trim();
  } catch {
    return 'unknown';
  }
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/') === process.argv[1].replace(/\\/g, '/');

if (isMain) {
  if (!fs.existsSync(distDir)) {
    console.error('dist/client does not exist. Run the build first.');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const info = { version: pkg.version, commit: resolveCommit() };
  fs.writeFileSync(path.join(distDir, 'version.json'), JSON.stringify(info) + '\n', 'utf8');
  console.log(`Wrote dist/client/version.json (v${info.version}, ${info.commit.slice(0, 7)})`);
}
