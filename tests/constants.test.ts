import { readFileSync } from 'fs';
import { join } from 'path';
import { SYSTEM_LIMITS } from '../src/packages/scannability';
import { IMAGE_UPLOAD_LIMITS } from '../src/packages/core/security';
import { MAX_GZIPPED_SIZE_KB, MAX_PAGE_FIRST_LOAD_KB } from '../scripts/check-bundle-size.js';

describe('Automated Unit Test Verification for Centralized Constants', () => {
  it('should document the correct file upload limits and formats in README.md', () => {
    const readmePath = join(__dirname, '../README.md');
    const readmeContent = readFileSync(readmePath, 'utf8');

    // Convert decimal to percentage for documentation check (e.g., 0.3 -> 30%)
    const expectedLogoSizeStr = `${SYSTEM_LIMITS.MAX_LOGO_SIZE * 100}%`;
    expect(readmeContent).toContain(`Maximum logo size is ${expectedLogoSizeStr}`);
    
    // Check supported formats
    const expectedFormatsStr = IMAGE_UPLOAD_LIMITS.SUPPORTED_IMAGE_FORMATS.join(', ');
    expect(readmeContent).toContain(`Supported custom logo formats are ${expectedFormatsStr}`);
    
    // Check max file size
    expect(readmeContent).toContain(`Maximum file size is ${IMAGE_UPLOAD_LIMITS.MAX_FILE_UPLOAD_MB}MB`);
  });

  it('should document the CI bundle size limit from scripts/check-bundle-size.js in SCALING.md', () => {
    const scalingPath = join(__dirname, '../docs/public/SCALING.md');
    const scalingContent = readFileSync(scalingPath, 'utf8');

    expect(scalingContent).toContain(`Worst Case First Load:** ${MAX_PAGE_FIRST_LOAD_KB} KB gzipped`);
    expect(scalingContent).toContain(`CI enforces a **${MAX_PAGE_FIRST_LOAD_KB} KB gzipped first-load budget per page**`);
    expect(scalingContent).toContain(`A loose **${MAX_GZIPPED_SIZE_KB} KB** ceiling`);
  });

  it('should document the CI bundle size limit from scripts/check-bundle-size.js in README.md and product.md', () => {
    const readmeContent = readFileSync(join(__dirname, '../README.md'), 'utf8');
    const productContent = readFileSync(join(__dirname, '../product.md'), 'utf8');

    expect(readmeContent).toContain(`exceeds ${MAX_PAGE_FIRST_LOAD_KB} KB`);
    expect(readmeContent).toContain(`exceed ${MAX_GZIPPED_SIZE_KB} KB`);
    expect(readmeContent).not.toMatch(/\b3 ?MB limit/);
    expect(productContent).toContain(`<= ${MAX_PAGE_FIRST_LOAD_KB} KB gzipped`);
    expect(productContent).toContain(`<= ${MAX_GZIPPED_SIZE_KB} KB`);
  });
});
