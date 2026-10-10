const eslintCommand = (filenames) => {
  const quotedFiles = filenames.map(f => `"${f.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ');
  return `eslint --fix --no-warn-ignored ${quotedFiles}`;
};

const prettierCommand = (filenames) => {
  const quotedFiles = filenames.map(f => `"${f.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ');
  return `prettier --write ${quotedFiles}`;
};

export default {
  '*': (filenames) => {
    const quotedFiles = filenames.map(f => `"${f.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ');
    return [
      `node scripts/secret-scanner.js ${quotedFiles}`,
      `node scripts/storage_privacy_ast_auditor.js ${quotedFiles}`,
      `node scripts/validate_ui_catalog.js ${quotedFiles}`,
      `node scripts/static-path-tracker.js ${quotedFiles}`,
      `node scripts/git_lineage_auditor.js ${quotedFiles}`
    ];
  },
  '**/*.{js,jsx,ts,tsx,mjs,cjs}': (filenames) => {
    return [eslintCommand(filenames), prettierCommand(filenames)];
  },
  '**/*.{css,json,yml,yaml}': (filenames) => {
    return prettierCommand(filenames);
  },
  // Documentation checks (the docs:lint suite minus the UI catalog check, which the
  // '*' entry above already runs on the staged files). They audit the whole doc set,
  // so they run once without file arguments.
  '**/*.md': (filenames) => {
    return [
      prettierCommand(filenames),
      'node scripts/audit_markdown.js',
      'node scripts/validate_adrs.js'
    ];
  }
};
