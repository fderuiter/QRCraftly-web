#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveBash, spawnBinary } from './utils/execHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const wizardsDir = path.join(__dirname, 'wizards');

const ALIAS_MAP = {
  cloudflare: 'setup-cloudflare',
  github: 'setup-github-ci',
  'github-ci': 'setup-github-ci',
  dev: 'setup-local-dev',
  'local-dev': 'setup-local-dev',
};

const SCRIPT_PNPM_MAP = {
  'setup-cloudflare': 'wizard:cloudflare',
  'setup-github-ci': 'wizard:github',
  'setup-local-dev': 'wizard:dev',
};

/**
 * Lists available wizards in the scripts/wizards directory.
 * @returns {string[]} List of wizard base names
 */
function getAvailableWizards() {
  if (!fs.existsSync(wizardsDir)) {
    return [];
  }
  return fs
    .readdirSync(wizardsDir)
    .filter(file => file.endsWith('.sh'))
    .map(file => file.replace(/\.sh$/, ''));
}

/**
 * Prints CLI usage instructions and lists available wizards.
 */
function printHelp() {
  console.log('\n🧙 QRCraftly DX Interactive Wizards');
  console.log('Usage: node scripts/run_wizard.js <wizard-name>\n');
  console.log('Available Wizards:');
  const available = getAvailableWizards();
  if (available.length === 0) {
    console.log('  (No wizards found in scripts/wizards/)');
  } else {
    for (const name of available) {
      const pnpmCmd = SCRIPT_PNPM_MAP[name] || `wizard:${name.replace(/^setup-/, '')}`;
      console.log(`  • ${name}  ->  pnpm run ${pnpmCmd}`);
    }
  }
  console.log('\nExamples:');
  console.log('  pnpm run wizard:cloudflare');
  console.log('  pnpm run wizard:github');
  console.log('  pnpm run wizard:dev\n');
}

function main() {
  const args = process.argv.slice(2);
  const rawTarget = args[0];

  if (!rawTarget || rawTarget === '--help' || rawTarget === '-h') {
    printHelp();
    process.exit(0);
  }

  const cleanedTarget = rawTarget.replace(/\.sh$/, '');
  const normalizedName = ALIAS_MAP[cleanedTarget] || cleanedTarget;
  const scriptPath = path.join(wizardsDir, `${normalizedName}.sh`);

  if (!fs.existsSync(scriptPath)) {
    console.error(`\n❌ Wizard '${rawTarget}' not found at ${scriptPath}`);
    printHelp();
    process.exit(1);
  }

  const bashBinary = resolveBash();
  const relativeScriptPath = path.relative(repoRoot, scriptPath).replace(/\\/g, '/');

  const result = spawnBinary(bashBinary, [relativeScriptPath, ...args.slice(1)], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(`\n❌ Failed to launch bash wizard using '${bashBinary}':`, result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

main();

