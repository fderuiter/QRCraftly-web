import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { syncUICatalog, syncAll } from '../scripts/sync_docs.js';
import { validateCatalog } from '../scripts/validate_ui_catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.join(__dirname, '..');
const tempTestDir = path.join(__dirname, 'temp_sync_docs_test');

describe('Documentation Synchronization Engine (docs:sync)', () => {
  const mockUiDir = path.join(tempTestDir, 'src/components/ui');
  const mockInputsDir = path.join(tempTestDir, 'src/components/inputs');
  const mockStyleControlsDir = path.join(tempTestDir, 'src/components/style-controls');
  const mockCatalogPath = path.join(tempTestDir, 'docs/public/UI_CATALOG.md');

  beforeAll(() => {
    fs.mkdirSync(mockUiDir, { recursive: true });
    fs.mkdirSync(mockInputsDir, { recursive: true });
    fs.mkdirSync(mockStyleControlsDir, { recursive: true });
    fs.mkdirSync(path.dirname(mockCatalogPath), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Reset test directory contents
    fs.readdirSync(mockUiDir).forEach(f => fs.rmSync(path.join(mockUiDir, f)));
    fs.readdirSync(mockInputsDir).forEach(f => fs.rmSync(path.join(mockInputsDir, f)));
    fs.readdirSync(mockStyleControlsDir).forEach(f => fs.rmSync(path.join(mockStyleControlsDir, f)));
  });

  describe('syncUICatalog()', () => {
    it('scaffolds missing components into the matching catalog section with test references', () => {
      // Setup mock components
      fs.writeFileSync(
        path.join(mockUiDir, 'ActionButton.tsx'),
        `/** A primary call-to-action button with loading states. */\nexport const ActionButton = () => <button />;`
      );
      fs.writeFileSync(path.join(mockUiDir, 'ActionButton.test.tsx'), `// test`);

      fs.writeFileSync(
        path.join(mockInputsDir, 'CustomUrlInput.tsx'),
        `export const CustomUrlInput = () => <input />;`
      );

      // Base catalog with only an existing dummy
      const initialCatalog = `---
publish-approved: true
---

# UI Catalog

## 1. Core Shared UI Elements (\`src/components/ui/\`)

- **ExistingModal** (\`ExistingModal.tsx\`): An existing modal component.

## 2. QR Input Form Panel Components (\`src/components/inputs/\`)

## 3. Styling & Customization Controls (\`src/components/style-controls/\`)

## 4. Shared Utilities & Renderers (\`src/utils/colorUtils.ts\`)
`;
      fs.writeFileSync(
        path.join(mockUiDir, 'ExistingModal.tsx'),
        `export const ExistingModal = () => <dialog />;`
      );
      fs.writeFileSync(mockCatalogPath, initialCatalog);

      const result = syncUICatalog(
        [mockUiDir, mockInputsDir, mockStyleControlsDir],
        mockCatalogPath,
        tempTestDir
      );

      expect(result.changed).toBe(true);

      const updatedCatalog = fs.readFileSync(mockCatalogPath, 'utf8');
      expect(updatedCatalog).toContain('**ActionButton** (`ActionButton.tsx` / `ActionButton.test.tsx`)');
      expect(updatedCatalog).toContain('A primary call-to-action button with loading states.');
      expect(updatedCatalog).toContain('**CustomUrlInput** (`CustomUrlInput.tsx`)');

      // Validate catalog integrity using validateCatalog validator
      const validationErrors = validateCatalog(
        [mockUiDir, mockInputsDir, mockStyleControlsDir],
        mockCatalogPath
      );
      expect(validationErrors).toHaveLength(0);
    });

    it('updates existing entries when a companion test file is added to disk', () => {
      fs.writeFileSync(path.join(mockUiDir, 'Card.tsx'), 'export const Card = () => <div />;');
      fs.writeFileSync(mockCatalogPath, `---
publish-approved: true
---

# UI Catalog

## 1. Core Shared UI Elements (\`src/components/ui/\`)

- **Card** (\`Card.tsx\`): Elegant card container with borders and shadow.

## 2. QR Input Form Panel Components (\`src/components/inputs/\`)

## 3. Styling & Customization Controls (\`src/components/style-controls/\`)

## 4. Shared Utilities & Renderers (\`src/utils/colorUtils.ts\`)
`);

      // Add a test file for Card on disk
      fs.writeFileSync(path.join(mockUiDir, 'Card.test.tsx'), '// card test');

      const result = syncUICatalog(
        [mockUiDir, mockInputsDir, mockStyleControlsDir],
        mockCatalogPath,
        tempTestDir
      );

      expect(result.changed).toBe(true);
      const updatedCatalog = fs.readFileSync(mockCatalogPath, 'utf8');
      expect(updatedCatalog).toContain('**Card** (`Card.tsx` / `Card.test.tsx`): Elegant card container with borders and shadow.');
    });

    it('is strictly idempotent when no components or tests have changed', () => {
      fs.writeFileSync(path.join(mockUiDir, 'Badge.tsx'), 'export const Badge = () => <span />;');
      fs.writeFileSync(path.join(mockUiDir, 'Badge.test.tsx'), '// test');

      const initialCatalog = `---
publish-approved: true
---

# UI Catalog

## 1. Core Shared UI Elements (\`src/components/ui/\`)

- **Badge** (\`Badge.tsx\` / \`Badge.test.tsx\`): Compact badge status indicator.

## 2. QR Input Form Panel Components (\`src/components/inputs/\`)

## 3. Styling & Customization Controls (\`src/components/style-controls/\`)

## 4. Shared Utilities & Renderers (\`src/utils/colorUtils.ts\`)
`;
      fs.writeFileSync(mockCatalogPath, initialCatalog);

      const firstPass = syncUICatalog(
        [mockUiDir, mockInputsDir, mockStyleControlsDir],
        mockCatalogPath,
        tempTestDir
      );
      expect(firstPass.changed).toBe(false);

      const catalogAfter = fs.readFileSync(mockCatalogPath, 'utf8');
      expect(catalogAfter).toBe(initialCatalog);
    });
  });

  describe('syncAll()', () => {
    it('runs catalog sync in one invocation', () => {
      fs.writeFileSync(path.join(mockUiDir, 'Box.tsx'), 'export const Box = () => <div />;');
      fs.writeFileSync(mockCatalogPath, `---
publish-approved: true
---

# UI Catalog

## 1. Core Shared UI Elements (\`src/components/ui/\`)

## 2. QR Input Form Panel Components (\`src/components/inputs/\`)

## 3. Styling & Customization Controls (\`src/components/style-controls/\`)

## 4. Shared Utilities & Renderers (\`src/utils/colorUtils.ts\`)
`);

      const result = syncAll({
        uiDirs: [mockUiDir, mockInputsDir, mockStyleControlsDir],
        catalogPath: mockCatalogPath,
        root: tempTestDir,
      });

      expect(result.changed).toBe(true);
      const catalog = fs.readFileSync(mockCatalogPath, 'utf8');
      expect(catalog).toContain('**Box** (`Box.tsx`)');
    });
  });

  describe('validate_ui_catalog.js --fix integration', () => {
    it('automatically repairs missing catalog entries when --fix is provided', async () => {
      const { execFileSync } = await import('child_process');
      // Create a component missing from the real catalog
      const dummyComponentPath = path.join(defaultRepoRoot, 'src/components/ui/TempSyncTestComp.tsx');
      try {
        fs.writeFileSync(dummyComponentPath, 'export const TempSyncTestComp = () => <div />;');
        
        // Running validate_ui_catalog without --fix should fail. Capture stderr
        // (instead of inheriting it) so the expected error stays out of the test log.
        let failed = false;
        let stderr = '';
        try {
          execFileSync('node', ['scripts/validate_ui_catalog.js', 'src/components/ui/TempSyncTestComp.tsx'], {
            cwd: defaultRepoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, SKIP_GIT_VALIDATION: '1' }
          });
        } catch (err) {
          failed = true;
          if (err && typeof err === 'object' && 'stderr' in err) {
            stderr = String(err.stderr);
          }
        }
        expect(failed).toBe(true);
        expect(stderr).toContain("UI component 'TempSyncTestComp.tsx' is missing from the catalog");

        // Running validate_ui_catalog with --fix should scaffold the entry and succeed
        const fixOutput = execFileSync(
          'node',
          ['scripts/validate_ui_catalog.js', '--fix', 'src/components/ui/TempSyncTestComp.tsx'],
          {
            cwd: defaultRepoRoot,
            encoding: 'utf8',
            env: { ...process.env, SKIP_GIT_VALIDATION: '1' }
          }
        );
        expect(fixOutput).toContain('Auto-fix flag (--fix) detected');
        expect(fixOutput).toContain('All catalog synchronization validations passed');

        const catalogContent = fs.readFileSync(path.join(defaultRepoRoot, 'docs/public/UI_CATALOG.md'), 'utf8');
        expect(catalogContent).toContain('**TempSyncTestComp** (`TempSyncTestComp.tsx`)');
      } finally {
        if (fs.existsSync(dummyComponentPath)) {
          fs.unlinkSync(dummyComponentPath);
        }
        // Re-sync to clean up the dummy entry
        const { syncUICatalog } = await import('../scripts/sync_docs.js');
        syncUICatalog();
      }
    });
  });
});
