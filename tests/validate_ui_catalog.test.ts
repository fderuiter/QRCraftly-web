import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateCatalog, checkLineage, parseGitStatus, parseArgs, decodeGitPath } from '../scripts/validate_ui_catalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempTestDir = path.join(__dirname, 'temp_validate_catalog_test');

describe('UI Catalog Validator and Lineage Sync Checks', () => {
  const mockUiDir = path.join(tempTestDir, 'ui');
  const mockCatalogPath = path.join(tempTestDir, 'UI_CATALOG.md');

  beforeAll(() => {
    fs.mkdirSync(tempTestDir, { recursive: true });
    fs.mkdirSync(mockUiDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  });

  describe('validateCatalog() Integrity Validation', () => {
    it('should pass validation when catalog perfectly matches disk files', () => {
      // Create mock UI component files
      fs.writeFileSync(path.join(mockUiDir, 'TestButton.tsx'), 'export const TestButton = () => <button />;');
      fs.writeFileSync(path.join(mockUiDir, 'TestButton.test.tsx'), '// test');
      fs.writeFileSync(path.join(mockUiDir, 'NoTestComp.tsx'), 'export const NoTestComp = () => <div />;');

      // Create a perfect mock catalog
      const mockCatalogContent = `
# UI Catalog
## 1. Core Shared UI Elements (\`src/components/ui/\`)
- **TestButton** (\`TestButton.tsx\` / \`TestButton.test.tsx\`): A fully accessible test button component with various states.
- **NoTestComp** (\`NoTestComp.tsx\`): Minimal container component designed without a test.
`;
      fs.writeFileSync(mockCatalogPath, mockCatalogContent);

      const errors = validateCatalog(mockUiDir, mockCatalogPath);
      expect(errors).toHaveLength(0);
    });

    it('should fail validation when a UI component file is missing from catalog', () => {
      fs.writeFileSync(path.join(mockUiDir, 'MissingComp.tsx'), 'export const MissingComp = () => <div />;');

      const errors = validateCatalog(mockUiDir, mockCatalogPath);
      expect(errors).toContain("UI component 'MissingComp.tsx' is missing from the catalog (UI_CATALOG.md).");

      // Clean up
      fs.unlinkSync(path.join(mockUiDir, 'MissingComp.tsx'));
    });

    it('should fail validation when a companion test file exists on disk but is not in catalog entry', () => {
      // Add a test file for NoTestComp.tsx
      fs.writeFileSync(path.join(mockUiDir, 'NoTestComp.test.tsx'), '// test');

      const errors = validateCatalog(mockUiDir, mockCatalogPath);
      expect(errors).toContain("UI component 'NoTestComp.tsx' has a companion test file 'NoTestComp.test.tsx' on disk, but it is not referenced in the catalog entry.");

      // Clean up
      fs.unlinkSync(path.join(mockUiDir, 'NoTestComp.test.tsx'));
    });

    it('should fail validation when catalog entry has an insufficient functional description', () => {
      // Rewrite catalog with too short description (less than 10 characters)
      const badCatalogContent = `
# UI Catalog
- **TestButton** (\`TestButton.tsx\` / \`TestButton.test.tsx\`): Short.
- **NoTestComp** (\`NoTestComp.tsx\`): Minimal container component designed without a test.
`;
      fs.writeFileSync(mockCatalogPath, badCatalogContent);

      const errors = validateCatalog(mockUiDir, mockCatalogPath);
      expect(errors).toContain("UI component 'TestButton.tsx' has an insufficient or missing functional description (must be at least 10 characters).");
    });

    it('should fail validation when catalog entry has invalid format without "):" delimiter', () => {
      const badCatalogContent = `
# UI Catalog
- **TestButton** (\`TestButton.tsx\` / \`TestButton.test.tsx\`) lacks colon description
- **NoTestComp** (\`NoTestComp.tsx\`): Minimal container component designed without a test.
`;
      fs.writeFileSync(mockCatalogPath, badCatalogContent);

      const errors = validateCatalog(mockUiDir, mockCatalogPath);
      expect(errors).toContain("UI component 'TestButton.tsx' catalog entry is missing or incorrectly formatted (expected '):' before description).");
    });

    it('should support validating multiple tracked directories', () => {
      const mockUiDir2 = path.join(tempTestDir, 'ui_test');
      const mockInputsDir = path.join(tempTestDir, 'inputs_test');
      fs.mkdirSync(mockUiDir2, { recursive: true });
      fs.mkdirSync(mockInputsDir, { recursive: true });

      fs.writeFileSync(path.join(mockUiDir2, 'TestButton.tsx'), 'export const TestButton = () => <button />;');
      fs.writeFileSync(path.join(mockInputsDir, 'TestInput.tsx'), 'export const TestInput = () => <input />;');

      const mockCatalogContent = `
# UI Catalog
- **TestButton** (\`TestButton.tsx\`): A button description.
- **TestInput** (\`TestInput.tsx\`): An input description.
`;
      const customCatalogPath = path.join(tempTestDir, 'CUSTOM_CATALOG.md');
      fs.writeFileSync(customCatalogPath, mockCatalogContent);

      const errors = validateCatalog([mockUiDir2, mockInputsDir], customCatalogPath);
      expect(errors).toHaveLength(0);

      // Clean up
      fs.rmSync(mockUiDir2, { recursive: true, force: true });
      fs.rmSync(mockInputsDir, { recursive: true, force: true });
      fs.unlinkSync(customCatalogPath);
    });

    it('should fail validation when a documented source file does not exist on disk', () => {
      const mockUiDirNew = path.join(tempTestDir, 'ui_not_exist_test');
      fs.mkdirSync(mockUiDirNew, { recursive: true });

      const mockCatalogContent = `
# UI Catalog
## 1. Core Shared UI Elements (\`src/components/ui/\`)
- **MissingSource** (\`MissingSource.tsx\`): This source component does not exist.
`;
      const customCatalogPath = path.join(tempTestDir, 'MISSING_SOURCE_CATALOG.md');
      fs.writeFileSync(customCatalogPath, mockCatalogContent);

      const errors = validateCatalog(mockUiDirNew, customCatalogPath);
      expect(errors).toContain("Documented source file 'MissingSource.tsx' does not exist on disk.");

      // Clean up
      fs.rmSync(mockUiDirNew, { recursive: true, force: true });
      fs.unlinkSync(customCatalogPath);
    });

    it('should fail validation when a documented test file does not exist in the same folder as its source component', () => {
      const mockUiDirNew = path.join(tempTestDir, 'ui_test_file_not_exist');
      fs.mkdirSync(mockUiDirNew, { recursive: true });
      fs.writeFileSync(path.join(mockUiDirNew, 'MyComp.tsx'), 'export const MyComp = () => <div />;');

      const mockCatalogContent = `
# UI Catalog
## 1. Core Shared UI Elements (\`src/components/ui/\`)
- **MyComp** (\`MyComp.tsx\` / \`MyComp.test.tsx\`): A component whose test file is missing.
`;
      const customCatalogPath = path.join(tempTestDir, 'MISSING_TEST_CATALOG.md');
      fs.writeFileSync(customCatalogPath, mockCatalogContent);

      const errors = validateCatalog(mockUiDirNew, customCatalogPath);
      expect(errors).toContain("Documented test file 'MyComp.test.tsx' does not exist in the same folder as its source component.");

      // Clean up
      fs.rmSync(mockUiDirNew, { recursive: true, force: true });
      fs.unlinkSync(customCatalogPath);
    });

    it('should fail validation if a component exists on disk but is listed under the wrong section heading in the catalog', () => {
      const mockUiDir1 = path.join(tempTestDir, 'ui_wrong_heading_test');
      const mockUiDir2 = path.join(tempTestDir, 'inputs_wrong_heading_test');
      fs.mkdirSync(mockUiDir1, { recursive: true });
      fs.mkdirSync(mockUiDir2, { recursive: true });

      // Put Accordion.tsx in ui_wrong_heading_test (so it's under ui)
      fs.writeFileSync(path.join(mockUiDir1, 'Accordion.tsx'), 'export const Accordion = () => <div />;');

      // Catalog lists Accordion.tsx under Inputs instead of UI
      const mockCatalogContent = `
# UI Catalog
## 1. Core Shared UI Elements (\`src/components/ui/\`)
- **Placeholder** (\`Placeholder.tsx\`): A generic placeholder description.

## 2. QR Input Form Panel Components (\`src/components/inputs/\`)
- **Accordion** (\`Accordion.tsx\`): Accordion component wrongly placed under inputs.
`;
      const customCatalogPath = path.join(tempTestDir, 'WRONG_HEADING_CATALOG.md');
      fs.writeFileSync(customCatalogPath, mockCatalogContent);

      const errors = validateCatalog([mockUiDir1, mockUiDir2], customCatalogPath);
      expect(errors.some(err => err.includes("wrong section heading") || err.includes("listed under the wrong section"))).toBe(true);

      // Clean up
      fs.rmSync(mockUiDir1, { recursive: true, force: true });
      fs.rmSync(mockUiDir2, { recursive: true, force: true });
      fs.unlinkSync(customCatalogPath);
    });
  });

  describe('shared src/components scope', () => {
    it('validates the real catalog, including shared components directly under src/components', () => {
      expect(validateCatalog()).toEqual([]);
    });

    it('maps a section to a directory by the exact backticked path in its heading', () => {
      const root = path.join(tempTestDir, 'scope');
      const componentsDir = path.join(root, 'src', 'components');
      const uiDir = path.join(componentsDir, 'ui');
      fs.mkdirSync(uiDir, { recursive: true });
      fs.writeFileSync(path.join(uiDir, 'Primitive.tsx'), 'export const Primitive = () => null;');
      fs.writeFileSync(path.join(componentsDir, 'Feature.tsx'), 'export const Feature = () => null;');
      const catalog = path.join(root, 'UI_CATALOG.md');
      fs.writeFileSync(catalog, [
        '# Catalog',
        '## 1. Core Shared UI Elements (`' + path.relative(path.join(__dirname, '..'), uiDir).split(path.sep).join('/') + '/`)',
        '- **Primitive** (`Primitive.tsx`): A primitive used by every feature component.',
        '## 4. Shared Feature Components (`' + path.relative(path.join(__dirname, '..'), componentsDir).split(path.sep).join('/') + '/`)',
        '- **Feature** (`Feature.tsx`): A shared feature component used by several routes.',
        '',
      ].join('\n'));

      expect(validateCatalog([uiDir, componentsDir], catalog)).toEqual([]);

      // A shared component that is not registered is reported.
      fs.writeFileSync(path.join(componentsDir, 'Unlisted.tsx'), 'export const Unlisted = () => null;');
      expect(validateCatalog([uiDir, componentsDir], catalog)).toContain("UI component 'Unlisted.tsx' is missing from the catalog (UI_CATALOG.md).");
    });

    it('does not attribute a section for an untracked subdirectory to its tracked parent', () => {
      const root = path.join(tempTestDir, 'nested');
      const componentsDir = path.join(root, 'src', 'components');
      fs.mkdirSync(path.join(componentsDir, 'labs'), { recursive: true });
      fs.writeFileSync(path.join(componentsDir, 'Feature.tsx'), 'export const Feature = () => null;');
      fs.writeFileSync(path.join(componentsDir, 'labs', 'Cockpit.tsx'), 'export const Cockpit = () => null;');
      const rel = path.relative(path.join(__dirname, '..'), componentsDir).split(path.sep).join('/');
      const catalog = path.join(root, 'UI_CATALOG.md');
      fs.writeFileSync(catalog, [
        '# Catalog',
        '## 3a. Labs Components (`' + rel + '/labs/`)',
        '- **Cockpit** (`Cockpit.tsx`): Labs layout documented in its own untracked section.',
        '## 4. Shared Feature Components (`' + rel + '/`)',
        '- **Feature** (`Feature.tsx`): A shared feature component used by several routes.',
        '',
      ].join('\n'));

      expect(validateCatalog([componentsDir], catalog)).toEqual([]);
    });

    it('does not force a catalog edit for behaviour-only edits to shared components', () => {
      expect(checkLineage(new Set(['src/components/QRTool.tsx']))).toEqual([]);
      expect(checkLineage(new Set(['src/components/ui/Button.tsx']))).toHaveLength(1);
    });
  });

  describe('checkLineage() Git History Checks', () => {
    it('should fail validation when a UI component file is modified without the catalog file', () => {
      const modified = new Set(['src/components/ui/Accordion.tsx']);
      const missing = checkLineage(modified);

      expect(missing).toHaveLength(1);
      expect(missing[0]).toEqual({
        codeFile: 'src/components/ui/Accordion.tsx',
        catalogFile: 'docs/public/UI_CATALOG.md'
      });
    });

    it('should fail validation when a UI component companion test file is modified without the catalog file', () => {
      const modified = new Set(['src/components/ui/Accordion.test.tsx']);
      const missing = checkLineage(modified);

      expect(missing).toHaveLength(1);
      expect(missing[0]).toEqual({
        codeFile: 'src/components/ui/Accordion.test.tsx',
        catalogFile: 'docs/public/UI_CATALOG.md'
      });
    });

    it('should fail validation when an inputs component file is modified without the catalog file', () => {
      const modified = new Set(['src/components/inputs/TextInput.tsx']);
      const missing = checkLineage(modified);

      expect(missing).toHaveLength(1);
      expect(missing[0]).toEqual({
        codeFile: 'src/components/inputs/TextInput.tsx',
        catalogFile: 'docs/public/UI_CATALOG.md'
      });
    });

    it('should fail validation when a style-controls component file is modified without the catalog file', () => {
      const modified = new Set(['src/components/style-controls/BorderControls.tsx']);
      const missing = checkLineage(modified);

      expect(missing).toHaveLength(1);
      expect(missing[0]).toEqual({
        codeFile: 'src/components/style-controls/BorderControls.tsx',
        catalogFile: 'docs/public/UI_CATALOG.md'
      });
    });

    it('should pass validation when both a UI component file and the catalog file are modified together', () => {
      const modified = new Set(['src/components/ui/Accordion.tsx', 'docs/public/UI_CATALOG.md']);
      const missing = checkLineage(modified);

      expect(missing).toHaveLength(0);
    });

    it('should pass validation when no UI component files are modified', () => {
      const modified = new Set(['src/utils/colorUtils.ts', 'src/components/inputs/README.md']);
      const missing = checkLineage(modified);

      expect(missing).toHaveLength(0);
    });

    it('should ignore non-component/utility scripts in src/components/ui/', () => {
      const modified = new Set(['src/components/ui/styles.ts']);
      const missing = checkLineage(modified);

      expect(missing).toHaveLength(0);
    });
  });

  describe('Git Status Output and Argument Parsing', () => {
    it('should parse git status porcelain output correctly', () => {
      const mockStdout = ` M src/components/ui/Button.tsx\n?? src/components/ui/NewComp.tsx\n R  old.tsx -> src/components/ui/Renamed.tsx`;
      const parsed = parseGitStatus(mockStdout);

      expect(parsed.has('src/components/ui/Button.tsx')).toBe(true);
      expect(parsed.has('src/components/ui/NewComp.tsx')).toBe(true);
      expect(parsed.has('src/components/ui/Renamed.tsx')).toBe(true);
    });

    it('should parse command-line arguments and filter non-existing or space-separated files correctly', () => {
      const args = ['--verbose', 'src/components/ui/Button.tsx', 'docs/public/UI_CATALOG.md'];
      const parsed = parseArgs(args);

      expect(parsed).toContain('src/components/ui/Button.tsx');
      expect(parsed).toContain('docs/public/UI_CATALOG.md');
    });

    it('should decode octal escape sequences in git path decoding', () => {
      const encoded = '"src/components/ui/sh\\303\\251.tsx"';
      const decoded = decodeGitPath(encoded);
      expect(decoded).toBe('src/components/ui/shé.tsx');
    });
  });
});
