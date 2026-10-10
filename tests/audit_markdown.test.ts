import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getFilesToAudit, reportError, REMEDIATION_HINTS, slugify, checkPlaceholders, buildFileHeadings, verifyLinks, resetErrors, checkCodeSnippets, existsSyncCaseSensitive, checkPublishApproved } from '../scripts/audit_markdown.js';

describe('audit_markdown', () => {
  beforeEach(() => {
    resetErrors();
  });

  describe('slugify', () => {
    it('should lower case and replace spaces with hyphens', () => {
      expect(slugify('My Heading Title')).toBe('my-heading-title');
    });

    it('should strip HTML tags', () => {
      expect(slugify('Heading <span class="badge">New</span>')).toBe('heading-new');
    });

    it('should remove non-word characters except hyphens', () => {
      expect(slugify('Hello World! @2026')).toBe('hello-world-2026');
    });
  });

  describe('checkPlaceholders', () => {
    it('should detect TODO and FIXME', () => {
      expect(checkPlaceholders('test.md', 'This is a TODO item')).toBe(true);
      expect(checkPlaceholders('test.md', 'Please FIXME immediately')).toBe(true);
    });

    it('should pass when no placeholders are present', () => {
      expect(checkPlaceholders('test.md', 'This is clean text with no markers')).toBe(false);
    });
  });

  describe('buildFileHeadings', () => {
    it('should extract and slugify headings', () => {
      const content = '# Introduction\n## Installation Guide\n### API Reference';
      const headings = buildFileHeadings('test.md', content);
      expect(headings.has('introduction')).toBe(true);
      expect(headings.has('installation-guide')).toBe(true);
      expect(headings.has('api-reference')).toBe(true);
    });

    it('reports unsupported Markdown once, with the line in the file', () => {
      resetErrors();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const content = '---\ndraft: false\n---\n# Title\n\nSubtitle\n--------\n';
        expect(buildFileHeadings('setext.md', content).size).toBe(0);
        expect(verifyLinks('setext.md', content, {})).toBe(false);
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const message = String(errorSpy.mock.calls[0][0]);
        expect(message).toContain('Error in setext.md: Unsupported Markdown: setext.md:7: setext headings');
        expect(message).toContain(`Fix: ${REMEDIATION_HINTS.unsupported}`);
      } finally {
        errorSpy.mockRestore();
        resetErrors();
      }
    });
  });

  describe('verifyLinks', () => {
    let existsSpy;

    beforeEach(() => {
      existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
        if (typeof p === 'string') {
          if (p.endsWith('missing.md')) return false;
          return true;
        }
        return false;
      });
    });

    afterEach(() => {
      existsSpy.mockRestore();
    });

    it('should ignore external links', () => {
      const content = '[Google](https://google.com) [Mail](mailto:test@example.com)';
      const fileHeadings = { 'test.md': new Set() };
      const hasLinkErrors = verifyLinks('test.md', content, fileHeadings);
      expect(hasLinkErrors).toBe(false);
    });

    it('should validate internal hash links inside the same file', () => {
      const content = '[Anchor Link](#my-anchor)';
      const fileHeadings = {
        'test.md': new Set(['my-anchor'])
      };
      
      const hasLinkErrors = verifyLinks('test.md', content, fileHeadings);
      expect(hasLinkErrors).toBe(false);
    });

    it('should flag internal hash links when anchor does not exist', () => {
      const content = '[Anchor Link](#missing-anchor)';
      const fileHeadings = {
        'test.md': new Set(['my-anchor'])
      };
      
      const hasLinkErrors = verifyLinks('test.md', content, fileHeadings);
      expect(hasLinkErrors).toBe(true);
    });

    it('should validate relative file links and check existence', () => {
      const content = '[About](../about.md)';
      const fileHeadings = {};

      const hasLinkErrors = verifyLinks('docs/test.md', content, fileHeadings);
      expect(hasLinkErrors).toBe(false);
    });

    it('should flag relative file links when file does not exist', () => {
      const content = '[About](../missing.md)';
      const fileHeadings = {};

      const hasLinkErrors = verifyLinks('docs/test.md', content, fileHeadings);
      expect(hasLinkErrors).toBe(true);
    });

    it('should block and flag any relative markdown link that resolves to a path outside the repository root', () => {
      const content = '[Malicious Link](../../../../etc/passwd)';
      const fileHeadings = {};

      const hasLinkErrors = verifyLinks('test.md', content, fileHeadings);
      expect(hasLinkErrors).toBe(true);
    });
  });

  describe('checkCodeSnippets', () => {
    const tempFile = 'temp_test_snippets.md';

    afterEach(() => {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });

    it('should pass when code snippets compile successfully', () => {
      fs.writeFileSync(
        tempFile,
        '```ts\nconst val: number = 42;\nconsole.log(val);\n```',
        'utf-8'
      );
      const hasErrors = checkCodeSnippets([tempFile]);
      expect(hasErrors).toBe(false);
    });

    it('should fail when code snippets contain compilation errors', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      fs.writeFileSync(
        tempFile,
        '```ts\nconst val: number = "not a number";\n```',
        'utf-8'
      );
      const hasErrors = checkCodeSnippets([tempFile]);
      expect(hasErrors).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  describe('Draft-Aware Documentation Auditing', () => {
    it('should ignore TODO/FIXME in draft documents but flag them in non-draft documents', () => {
      const draftContent = `---\ndraft: true\n---\n# Draft Doc\nTODO: write this guide. FIXME later.`;
      const nonDraftContent = `---\ndraft: false\n---\n# Production Doc\nTODO: write this guide.`;
      const noFrontmatterContent = `# Production Doc\nFIXME: bug here.`;

      expect(checkPlaceholders('draft.md', draftContent)).toBe(false);
      expect(checkPlaceholders('nondraft.md', nonDraftContent)).toBe(true);
      expect(checkPlaceholders('nofromtmatter.md', noFrontmatterContent)).toBe(true);
    });

    it('should bypass syntax and compiler checks for code blocks in draft documents', () => {
      const draftFile = 'temp_draft_snippet.md';
      fs.writeFileSync(
        draftFile,
        `---\ndraft: true\n---\n\`\`\`ts\nconst badVal: number = "this is not a number";\n\`\`\``,
        'utf-8'
      );
      try {
        const hasErrors = checkCodeSnippets([draftFile]);
        expect(hasErrors).toBe(false);
      } finally {
        if (fs.existsSync(draftFile)) {
          fs.unlinkSync(draftFile);
        }
      }
    });

    it('should still validate and flag broken link targets inside draft documents', () => {
      const draftContent = `---\ndraft: true\n---\n# Draft Doc\n[Broken Target](../missing.md)`;
      const hasLinkErrors = verifyLinks('docs/draft.md', draftContent, {});
      expect(hasLinkErrors).toBe(true);
    });
  });

  describe('Quarantine and Strict Opt-In Auditing', () => {
    it('should fail validation if a public folder file lacks publish-approved metadata', () => {
      const content = `---\ntitle: "No Publish Approved"\n---\n# Some Content`;
      // Import checkPublishApproved from audit_markdown.js
      const { checkPublishApproved } = require('../scripts/audit_markdown.js');
      const hasErrors = checkPublishApproved('docs/public/test-no-approve.md', content);
      expect(hasErrors).toBe(true);
    });

    it('should pass validation if a public folder file has publish-approved: true metadata', () => {
      const content = `---\npublish-approved: true\ntitle: "Yes Publish Approved"\n---\n# Some Content`;
      const { checkPublishApproved } = require('../scripts/audit_markdown.js');
      const hasErrors = checkPublishApproved('docs/public/test-yes-approve.md', content);
      expect(hasErrors).toBe(false);
    });

    it('should pass validation for a non-public folder file even without publish-approved metadata', () => {
      const content = `# Global File`;
      const { checkPublishApproved } = require('../scripts/audit_markdown.js');
      const hasErrors = checkPublishApproved('docs/SECURITY.md', content);
      expect(hasErrors).toBe(false);
    });

    it('should completely bypass checking placeholders and return false for quarantined files', () => {
      const content = `TODO: this contains a placeholder but is quarantined.`;
      const hasPlaceholderErrors = checkPlaceholders('docs/internal/note.md', content);
      expect(hasPlaceholderErrors).toBe(false);

      const hasApproveErrors = checkPublishApproved('docs/internal/note.md', content);
      expect(hasApproveErrors).toBe(false);
    });

    it('should ignore uppercase or mixed-case quarantine folder variations', () => {
      const content = `TODO: this is a draft in uppercase quarantine folder.`;
      expect(checkPlaceholders('docs/Internal/note.md', content)).toBe(false);
      expect(checkPlaceholders('docs/QUARANTINE/note.md', content)).toBe(false);
      expect(checkPlaceholders('docs/Quarantined/note.md', content)).toBe(false);
    });
  });

  describe('existsSyncCaseSensitive & Targeted Case Safety', () => {
    it('should accurately validate exact case existence on disk', () => {
      const readmePath = path.join(process.cwd(), 'README.md');
      const lowerReadmePath = path.join(process.cwd(), 'readme.md');

      if (fs.existsSync(readmePath)) {
        expect(existsSyncCaseSensitive(readmePath)).toBe(true);
        expect(existsSyncCaseSensitive(lowerReadmePath)).toBe(false);
      }
    });

    it('should flag relative file links pointing to files with mismatched casing on disk', () => {
      // SECURITY.md exists in repo root or docs/SECURITY.md
      const secPath = path.join(process.cwd(), 'docs', 'SECURITY.md');
      if (fs.existsSync(secPath)) {
        const content = '[Security Notice](security.md)';
        const fileHeadings = {};
        const hasErrors = verifyLinks('docs/public/guide.md', content, fileHeadings);
        expect(hasErrors).toBe(true);
      }
    });

    it('should pass mixed-case heading anchor fragment links successfully', () => {
      const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      try {
        const content = '[Anchor Link](#My-Mixed-Case-Heading)';
        const fileHeadings = {
          'test.md': new Set(['my-mixed-case-heading'])
        };

        const hasLinkErrors = verifyLinks('test.md', content, fileHeadings);
        expect(hasLinkErrors).toBe(false);
      } finally {
        existsSpy.mockRestore();
      }
    });
  });

  describe('audited file set', () => {
    it('covers CONTEXT.md, AGENTS.md, ADRs and agent docs as well as the public docs', () => {
      const files = getFilesToAudit();
      expect(files).toEqual(expect.arrayContaining([
        'README.md',
        'CONTEXT.md',
        'AGENTS.md',
        'docs/SECURITY.md',
        'docs/public/COMPLIANCE.md',
        'docs/agents/domain.md',
        'docs/adr/0001-client-side-storage-allowlist.md'
      ]));
      expect(new Set(files).size).toBe(files.length);
      for (const file of files) {
        expect(file).not.toContain('\\');
      }
    });
  });

  describe('remediation hints', () => {
    it('prints a Fix: hint with every error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        checkPlaceholders('doc.md', 'A TODO marker');
        verifyLinks('docs/doc.md', '[x](./nope-missing.md)', {});
        verifyLinks('doc.md', '[x](#absent)', { 'doc.md': new Set(['present']) });
        const messages = errorSpy.mock.calls.map(call => String(call[0]));
        expect(messages.length).toBeGreaterThanOrEqual(3);
        for (const message of messages) {
          expect(message).toMatch(/\n {2}Fix: \S/);
        }
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('has a hint for every error kind', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const kinds: Array<keyof typeof REMEDIATION_HINTS> = [
          'missingFile', 'publishApproved', 'placeholder', 'outsideRoot',
          'brokenFile', 'brokenAnchor', 'snippet', 'unsupported'
        ];
        expect([...kinds].sort()).toEqual(Object.keys(REMEDIATION_HINTS).sort());
        for (const kind of kinds) {
          reportError('x.md', 'problem', kind);
        }
        expect(errorSpy).toHaveBeenCalledTimes(kinds.length);
        for (const call of errorSpy.mock.calls) {
          expect(String(call[0])).toContain('Fix: ');
        }
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
