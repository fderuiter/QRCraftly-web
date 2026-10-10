import { execBinary } from './utils/execHelper.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const UI_DIR = path.resolve(__dirname, '../src/components/ui');

/**
 * Sorts a class string and resolves/deduplicates classes.
 * Supports static sections and template interpolations.
 * @param {string} classStr The input classes.
 * @returns {string} The sorted and deduplicated class string.
 */
export function sortClassString(classStr) {
  const parts = classStr.split(/(\$\{[^}]+\})/g);
  
  const processedParts = parts.map(part => {
    if (part.startsWith('${') && part.endsWith('}')) {
      return part;
    } else {
      const classes = part.trim().split(/\s+/).filter(Boolean);
      const uniqueClasses = Array.from(new Set(classes));
      uniqueClasses.sort();
      
      const prefix = part.startsWith(' ') ? ' ' : '';
      const suffix = part.endsWith(' ') ? ' ' : '';
      if (uniqueClasses.length === 0) return '';
      return prefix + uniqueClasses.join(' ') + suffix;
    }
  });

  return processedParts.join('');
}

/**
 * Sorts classes inside a file content.
 * @param {string} content The file content to modify.
 * @returns {string} The modified file content.
 */
export function sortClassesInContent(content) {
  let updated = content;

  updated = updated.replace(/className="([^"]+)"/g, (match, p1) => {
    return `className="${sortClassString(p1)}"`;
  });
  updated = updated.replace(/className='([^']+)'/g, (match, p1) => {
    return `className='${sortClassString(p1)}'`;
  });

  updated = updated.replace(/className=\{`([^`]+)`\}/g, (match, p1) => {
    return `className={\`${sortClassString(p1)}\`}`;
  });

  // Target specific styling variables in ui components precisely
  const variables = [
    'BASE_INPUT_CLASSES',
    'TEXT_FIELD_CLASSES',
    'TEXT_AREA_CLASSES',
    'SELECT_CLASSES',
    'ERROR_INPUT_CLASSES',
    'baseStyles',
    'variantStyles',
    'sizeStyles'
  ];

  for (const varName of variables) {
    const regex = new RegExp(`\\b(${varName})\\s*=\\s*(['"\`])([^'"\`\\n]+)\\2`, 'g');
    updated = updated.replace(regex, (match, name, quote, p1) => {
      return `${name} = ${quote}${sortClassString(p1)}${quote}`;
    });
  }

  return updated;
}

/**
 * Recursively find all ts/tsx files under directory.
 * @param {string} dir Directory to scan.
 * @returns {string[]} Paths of all matching files.
 */
export function getFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFiles(filePath));
    } else {
      if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
        results.push(filePath);
      }
    }
  });
  return results;
}

// Only run automatically if executed directly
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('sort_tailwind_classes.js'))) {
  const checkOnly = process.argv.includes('--check');

  // Extract arguments, filtering out option flags
  const files = process.argv.slice(2).filter(arg => arg !== '--check');

  // If files are provided as arguments, format/check those files.
  // Otherwise, default to "src" directory to cover all folders repository-wide.
  const targets = files.length > 0 ? files : ['src'];

  try {
    if (checkOnly) {
      console.log(`🔍 AST-based Tailwind sorting check on: ${targets.join(' ')}`);
      execBinary('pnpm', ['exec', 'eslint', ...targets], { stdio: 'inherit' });
      console.log('✨ All classes are properly sorted and aligned!');
    } else {
      console.log(`⚙️ Formatting Tailwind CSS classes for: ${targets.join(' ')}`);
      execBinary('pnpm', ['exec', 'eslint', '--fix', ...targets], { stdio: 'inherit' });
      console.log('✅ Tailwind CSS classes sorted successfully!');
    }
    process.exit(0);
  } catch {
    console.error('❌ Tailwind CSS class sorting check or format failed.');
    process.exit(1);
  }
}
