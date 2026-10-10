// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/constants';
import { PREBUILT_TEMPLATES } from '../src/data/brandTemplates';
import { QRConfig, QRStyle, QRType, QRErrorCorrectionLevel } from '../src/types';
import {
  BRAND_TEMPLATES_STORAGE_KEY,
  MAX_CUSTOM_TEMPLATES,
  getStoredTemplates,
  saveCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  validateTemplateJson,
  applyTemplateToConfig,
  extractStyleConfig,
  addImportedTemplate,
  isTemplateStorageAvailable,
  TEMPLATE_STORAGE_ERROR,
} from '../src/utils/brandTemplateManager';

describe('Brand Template Gallery & Persistence System', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('Pre-built Templates Data', () => {
    it('provides curated pre-built design themes', () => {
      expect(PREBUILT_TEMPLATES.length).toBeGreaterThanOrEqual(6);
      PREBUILT_TEMPLATES.forEach((tpl) => {
        expect(tpl.id).toBeDefined();
        expect(tpl.name).toBeDefined();
        expect(tpl.isPrebuilt).toBe(true);
        expect(tpl.config).toBeDefined();
        expect(tpl.config.fgColor).toMatch(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
        expect(tpl.config.bgColor).toMatch(/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
      });
    });
  });

  describe('Local Storage Persistence', () => {
    it('saves visual settings as named brand template and persists in localStorage', () => {
      const mockConfig: QRConfig = {
        ...DEFAULT_CONFIG,
        value: 'https://example.com/secret-payload',
        type: QRType.URL,
        fgColor: '#0f766e',
        bgColor: '#f0fdf4',
        eyeColor: '#047857',
        style: QRStyle.MODERN,
        isBorderEnabled: true,
        borderColor: '#0d9488',
      };

      const result = saveCustomTemplate('Acme Marketing Teal', 'Official brand colors', mockConfig);
      expect(result.success).toBe(true);
      expect(result.template).toBeDefined();
      expect(result.template?.name).toBe('Acme Marketing Teal');
      expect(result.template?.config.fgColor).toBe('#0f766e');
      expect(result.template?.config.style).toBe(QRStyle.MODERN);

      // Verify persistence across reloads via localStorage
      const stored = getStoredTemplates();
      expect(stored.length).toBe(1);
      expect(stored[0].name).toBe('Acme Marketing Teal');
      expect(stored[0].config.fgColor).toBe('#0f766e');
    });

    it('enforces 50 template storage limit quota', () => {
      const mockConfig: QRConfig = { ...DEFAULT_CONFIG };

      // Fill storage up to MAX_CUSTOM_TEMPLATES (50)
      for (let i = 1; i <= MAX_CUSTOM_TEMPLATES; i++) {
        const res = saveCustomTemplate(`Template ${i}`, undefined, mockConfig);
        expect(res.success).toBe(true);
      }

      expect(getStoredTemplates().length).toBe(50);

      // Attempting to save 51st template must fail with quota error
      const overflowResult = saveCustomTemplate('Template 51', undefined, mockConfig);
      expect(overflowResult.success).toBe(false);
      expect(overflowResult.error).toContain('Storage limit reached');
      expect(getStoredTemplates().length).toBe(50);
    });

    it('supports template renaming and deletion', () => {
      const mockConfig: QRConfig = { ...DEFAULT_CONFIG, fgColor: '#123456' };
      const saved = saveCustomTemplate('Original Name', 'Desc', mockConfig);
      const id = saved.template!.id;

      // Rename
      const renameRes = updateCustomTemplate(id, { name: 'New Brand Name' });
      expect(renameRes.success).toBe(true);
      expect(renameRes.template?.name).toBe('New Brand Name');
      expect(getStoredTemplates()[0].name).toBe('New Brand Name');

      // Delete
      const deleted = deleteCustomTemplate(id);
      expect(deleted).toBe(true);
      expect(getStoredTemplates().length).toBe(0);
    });
  });

  describe('UX Guardrail: Payload Content Protection', () => {
    it('never overwrites active QR code payload content when applying a template', () => {
      const activeConfig: QRConfig = {
        ...DEFAULT_CONFIG,
        value: 'WIFI:S:SecretWifiNetwork;P:MySuperSecretPassword;T:WPA;;',
        type: QRType.WIFI,
        borderText: 'SCAN ME FOR WIFI',
        templateHeadline: 'JOIN OUR NETWORK',
        templateSubtext: 'Free WiFi Access',
        fgColor: '#000000',
        bgColor: '#ffffff',
        style: QRStyle.STANDARD,
      };

      const templateConfig: Partial<QRConfig> = {
        fgColor: '#6b21a8',
        bgColor: '#faf5ff',
        eyeColor: '#581c87',
        style: QRStyle.FLUID,
        isBorderEnabled: true,
        borderColor: '#7e22ce',
        // Malicious or accidental attempt to supply value/type inside template
        value: 'https://attacker.com/override',
        type: QRType.URL,
        borderText: 'ATTACKER TEXT',
      };

      const updates = applyTemplateToConfig(activeConfig, templateConfig);

      // Visual fields should be updated
      expect(updates.fgColor).toBe('#6b21a8');
      expect(updates.bgColor).toBe('#faf5ff');
      expect(updates.style).toBe(QRStyle.FLUID);

      // Content payload fields must NOT be in updates
      expect(updates.value).toBeUndefined();
      expect(updates.type).toBeUndefined();
      expect(updates.borderText).toBeUndefined();
      expect(updates.templateHeadline).toBeUndefined();

      // Merged config must preserve original non-style payload content
      const mergedConfig: QRConfig = { ...activeConfig, ...updates };
      expect(mergedConfig.value).toBe('WIFI:S:SecretWifiNetwork;P:MySuperSecretPassword;T:WPA;;');
      expect(mergedConfig.type).toBe(QRType.WIFI);
      expect(mergedConfig.borderText).toBe('SCAN ME FOR WIFI');
      expect(mergedConfig.templateHeadline).toBe('JOIN OUR NETWORK');
      expect(mergedConfig.templateSubtext).toBe('Free WiFi Access');
    });

    it('extractStyleConfig strips content fields when extracting visual settings', () => {
      const fullConfig: QRConfig = {
        ...DEFAULT_CONFIG,
        value: 'Sensitive User Input',
        type: QRType.TEXT,
        borderText: 'Confidential',
        fgColor: '#123456',
        bgColor: '#654321',
      };

      const extracted = extractStyleConfig(fullConfig);
      expect(extracted.fgColor).toBe('#123456');
      expect(extracted.bgColor).toBe('#654321');
      expect((extracted as Record<string, unknown>).value).toBeUndefined();
      expect((extracted as Record<string, unknown>).type).toBeUndefined();
      expect((extracted as Record<string, unknown>).borderText).toBeUndefined();
    });

    it('never saves or applies user-uploaded images', () => {
      const images = {
        logoUrl: 'data:image/png;base64,bG9nbw==',
        borderLogoUrl: 'data:image/png;base64,Ym9yZGVy',
        backgroundImageUrl: 'data:image/png;base64,Ymc=',
        mosaicImageUrl: 'data:image/png;base64,bW9zYWlj',
      };
      const extracted = extractStyleConfig({ ...DEFAULT_CONFIG, ...images, logoSize: 0.3 });
      expect(extracted.logoSize).toBe(0.3);
      for (const key of Object.keys(images)) {
        expect((extracted as Record<string, unknown>)[key]).toBeUndefined();
      }

      const updates = applyTemplateToConfig(DEFAULT_CONFIG, images);
      expect(updates).toEqual({});
    });
  });

  describe('JSON Export & Strict Schema Validation Import', () => {
    it('validates and accepts valid export JSON wrapper files', () => {
      const validPayload = {
        version: '1.0',
        type: 'qrcraftly-brand-template',
        template: {
          id: 'custom-12345',
          name: 'Teal Enterprise',
          description: 'Official corporate design',
          config: {
            fgColor: '#0f766e',
            bgColor: '#ffffff',
            eyeColor: '#115e59',
            style: QRStyle.MODERN,
            errorCorrectionLevel: QRErrorCorrectionLevel.H,
          },
        },
      };

      const validation = validateTemplateJson(validPayload);
      expect(validation.valid).toBe(true);
      expect(validation.template).toBeDefined();
      expect(validation.template?.name).toBe('Teal Enterprise');
      expect(validation.template?.config.fgColor).toBe('#0f766e');
      expect(validation.template?.config.style).toBe(QRStyle.MODERN);
    });

    it('sanitizes and strips payload/content injection from imported JSON', () => {
      const maliciousPayload = {
        type: 'qrcraftly-brand-template',
        template: {
          name: 'Injected Template',
          config: {
            fgColor: '#123456',
            bgColor: '#ffffff',
            value: 'https://malicious-site.com/phishing',
            type: 'URL',
            borderText: 'Phishing Text',
          },
        },
      };

      const validation = validateTemplateJson(maliciousPayload);
      expect(validation.valid).toBe(true);
      expect(validation.template?.config.fgColor).toBe('#123456');
      // Must NOT contain content fields
      expect((validation.template?.config as Record<string, unknown>).value).toBeUndefined();
      expect((validation.template?.config as Record<string, unknown>).type).toBeUndefined();
      expect((validation.template?.config as Record<string, unknown>).borderText).toBeUndefined();
    });

    it('rejects malformed or invalid template JSON payloads', () => {
      expect(validateTemplateJson(null).valid).toBe(false);
      expect(validateTemplateJson('string').valid).toBe(false);
      expect(validateTemplateJson({}).valid).toBe(false);
      expect(validateTemplateJson({ name: '' }).valid).toBe(false);
      expect(validateTemplateJson({ name: 'Valid Name', config: null }).valid).toBe(false);
    });
  });

  describe('Import validation drops what the generator cannot use', () => {
    const wrap = (config: Record<string, unknown>) => ({ name: 'Hand edited', config });

    it('drops non-string colours, unknown enum values, out-of-range numbers and unknown keys', () => {
      const validation = validateTemplateJson(
        wrap({
          fgColor: 0,
          socialFormat: 'square',
          borderStyle: 'groove',
          logoSize: 3,
          futureSetting: true,
          bgColor: '#FFFFFF',
          value: 'https://example.com',
        })
      );
      expect(validation.valid).toBe(true);
      expect(validation.template?.config).toEqual({ bgColor: '#ffffff' });
      // Four invalid values and one unknown key; the content field is dropped without counting.
      expect(validation.skipped).toBe(5);
    });

    it('keeps valid mosaic, eye and maze settings', () => {
      const validation = validateTemplateJson(
        wrap({ mosaicMode: 'halftone', mosaicContrast: 0.4, eyeFrameColor: '#112233', eyeBallColor: '#445566', mazePathWidth: 0.3 })
      );
      expect(validation.skipped).toBe(0);
      expect(validation.template?.config).toEqual({
        mosaicMode: 'halftone',
        mosaicContrast: 0.4,
        eyeFrameColor: '#112233',
        eyeBallColor: '#445566',
        mazePathWidth: 0.3,
      });
    });

    it('round-trips a saved template through export and import unchanged', () => {
      const saved = saveCustomTemplate('Round trip', undefined, { ...DEFAULT_CONFIG, fgColor: '#123456' });
      const validation = validateTemplateJson({ type: 'qrcraftly-brand-template', template: saved.template });
      expect(validation.skipped).toBe(0);
      expect(validation.template?.config.fgColor).toBe('#123456');
    });
  });

  describe('Blocked or full site storage', () => {
    const blockStorage = () =>
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });

    it('reads no templates and refuses to save without throwing when storage is blocked', () => {
      blockStorage();
      expect(isTemplateStorageAvailable()).toBe(false);
      expect(getStoredTemplates()).toEqual([]);
      expect(saveCustomTemplate('Blocked', undefined, DEFAULT_CONFIG)).toEqual({ success: false, error: TEMPLATE_STORAGE_ERROR });
      expect(deleteCustomTemplate('anything')).toBe(false);
    });

    it('reports a storage error when an import cannot be written', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const validation = validateTemplateJson({ name: 'Imported', config: { fgColor: '#000000' } });
      expect(validation.template).toBeDefined();
      if (!validation.template) return;
      expect(addImportedTemplate(validation.template)).toEqual({ success: false, error: TEMPLATE_STORAGE_ERROR });
    });

    it('adds an imported template to the front of the stored list', () => {
      saveCustomTemplate('Existing', undefined, DEFAULT_CONFIG);
      const validation = validateTemplateJson({ name: 'Imported', config: { fgColor: '#000000' } });
      if (!validation.template) throw new Error('expected a template');
      const result = addImportedTemplate(validation.template);
      expect(result.success).toBe(true);
      expect(getStoredTemplates().map(t => t.name)).toEqual(['Imported', 'Existing']);
    });
  });
});
