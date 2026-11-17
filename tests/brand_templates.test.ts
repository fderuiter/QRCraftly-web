// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { PREBUILT_TEMPLATES } from '../src/data/brandTemplates';
import { type QRConfig, QRStyle, QRType, QRErrorCorrectionLevel, EyeShape } from '@/packages/core/types';
import { getContrastRatio } from '@/packages/core/encoding';
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
  CONTENT_FIELDS,
} from '../src/utils/brandTemplateManager';
import { isStyleField, STYLE_BASELINE } from '../src/utils/styleFields';

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

    it('configures active frame shapes, badges, and positions on at least four starter templates', () => {
      const framedTemplates = PREBUILT_TEMPLATES.filter(
        (tpl) => tpl.config.frameStyle && tpl.config.frameStyle !== 'none'
      );
      expect(framedTemplates.length).toBeGreaterThanOrEqual(4);

      framedTemplates.forEach((tpl) => {
        expect(tpl.config.frameStyle).toBeDefined();
        expect(tpl.config.frameText).toBeDefined();
        expect(tpl.config.frameBgColor).toBeDefined();
        expect(tpl.config.frameTextColor).toBeDefined();
        expect(tpl.config.frameIcon).toBeDefined();
        expect(tpl.config.framePosition).toBeDefined();

        // Constraint: All prebuilt template frame colors must maintain contrast ratio of at least 4.5:1
        const ratio = getContrastRatio(tpl.config.frameTextColor!, tpl.config.frameBgColor!);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    });

    it('applies frameText from template when current frameText is blank and preserves custom text when set', () => {
      const tealTemplate = PREBUILT_TEMPLATES.find((tpl) => tpl.name === 'Modern Teal')!;
      expect(tealTemplate).toBeDefined();

      // Blank active frame text -> template frameText is applied
      const blankConfig: QRConfig = { ...DEFAULT_CONFIG, frameText: '' };
      const updatesForBlank = applyTemplateToConfig(blankConfig, tealTemplate.config);
      expect(updatesForBlank.frameStyle).toBe('pill');
      expect(updatesForBlank.frameText).toBe('SCAN ME');

      // User already typed custom text -> preserved
      const customConfig: QRConfig = { ...DEFAULT_CONFIG, frameText: 'VISIT MY CAFE' };
      const updatesForCustom = applyTemplateToConfig(customConfig, tealTemplate.config);
      expect(updatesForCustom.frameStyle).toBe('pill');
      expect(updatesForCustom.frameText).toBeUndefined();
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
      for (const key of Object.keys(images)) {
        expect((updates as Record<string, unknown>)[key]).toBeUndefined();
      }
      expect(updates).toEqual(STYLE_BASELINE);
    });

    it('clears active frames, gradients, and eye shapes while preserving payload text and user-uploaded logos', () => {
      const activeConfig: QRConfig = {
        ...DEFAULT_CONFIG,
        value: 'https://example.com/preserve-this-url',
        type: QRType.URL,
        logoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        frameStyle: 'banner',
        frameText: 'USER FRAME TEXT',
        frameIcon: 'heart',
        frameBgColor: '#e11d48',
        frameTextColor: '#ffffff',
        framePosition: 'top',
        gradientType: 'linear',
        gradientColorStops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
        gradientAngle: 45,
        eyeFrameShape: EyeShape.CIRCLE,
        eyeBallShape: EyeShape.ROUNDED,
        eyeFrameColor: '#ff0000',
        eyeBallColor: '#0000ff',
      };

      // Classic Slate preset omits frame, gradient, and eye shapes
      const classicSlate = PREBUILT_TEMPLATES.find((t) => t.name === 'Classic Slate')!;
      expect(classicSlate).toBeDefined();

      const updates = applyTemplateToConfig(activeConfig, classicSlate.config);
      const merged: QRConfig = { ...activeConfig, ...updates };

      // Omitted visual fields must be cleanly reset
      expect(merged.frameStyle).toBe('none');
      expect(merged.gradientType).toBe('none');
      expect(merged.eyeFrameShape).toBeUndefined();
      expect(merged.eyeBallShape).toBeUndefined();
      expect(merged.eyeFrameColor).toBeUndefined();
      expect(merged.eyeBallColor).toBeUndefined();

      // Template's explicitly defined styles must be applied
      expect(merged.fgColor).toBe('#334155');
      expect(merged.bgColor).toBe('#f8fafc');
      expect(merged.eyeColor).toBe('#0f172a');
      expect(merged.style).toBe(QRStyle.STANDARD);

      // User payload content and user-uploaded logo must be strictly preserved
      expect(merged.value).toBe('https://example.com/preserve-this-url');
      expect(merged.type).toBe(QRType.URL);
      expect(merged.logoUrl).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
      expect(merged.frameText).toBe('USER FRAME TEXT');
    });

    it('resets omitted border properties to baseline defaults for templates with partial border configurations', () => {
      const activeConfig: QRConfig = {
        ...DEFAULT_CONFIG,
        isBorderEnabled: true,
        borderSize: 0.12,
        borderStyle: 'dotted',
        borderColor: '#aabbcc',
        borderTextColor: '#112233',
        borderText: 'PRESERVED BORDER TEXT',
      };

      const partialBorderTemplate: Partial<QRConfig> = {
        fgColor: '#10b981',
        bgColor: '#f0fdf4',
        isBorderEnabled: true,
        borderColor: '#059669',
      };

      const updates = applyTemplateToConfig(activeConfig, partialBorderTemplate);
      const merged: QRConfig = { ...activeConfig, ...updates };

      // Configured properties from template applied
      expect(merged.isBorderEnabled).toBe(true);
      expect(merged.borderColor).toBe('#059669');
      expect(merged.fgColor).toBe('#10b981');

      // Omitted border visual properties reset to baseline defaults
      expect(merged.borderSize).toBe(0.05);
      expect(merged.borderStyle).toBe('solid');
      expect(merged.borderTextColor).toBe('#ffffff');
      expect(merged.borderTextPosition).toBe('bottom-center');
      expect(merged.borderLogoPosition).toBe('bottom-center');

      // User border text preserved
      expect(merged.borderText).toBe('PRESERVED BORDER TEXT');
    });

    it('defines clean baseline defaults for all style fields', () => {
      expect(STYLE_BASELINE.frameStyle).toBe('none');
      expect(STYLE_BASELINE.gradientType).toBe('none');
      expect(STYLE_BASELINE.eyeFrameShape).toBeUndefined();
      expect(STYLE_BASELINE.eyeBallShape).toBeUndefined();
      expect(STYLE_BASELINE.isBorderEnabled).toBe(false);
      expect(STYLE_BASELINE.borderSize).toBe(0.05);
      expect(STYLE_BASELINE.borderStyle).toBe('solid');
      expect(STYLE_BASELINE.quietZoneModules).toBe(4);
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

  describe('one classification for every config key (#1583)', () => {
    /** The property names of QRConfig, read from its declaration so a new field cannot be missed. */
    function qrConfigKeys(): string[] {
      const file = path.resolve(__dirname, '../src/packages/core/types.ts');
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
      const keys: string[] = [];
      source.forEachChild((node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === 'QRConfig') {
          for (const member of node.members) if (member.name) keys.push(member.name.getText(source));
        }
      });
      return keys;
    }

    it('puts each QRConfig key in exactly one of CONTENT_FIELDS and STYLE_FIELDS', () => {
      const keys = qrConfigKeys();
      expect(keys.length).toBeGreaterThan(50);
      const misclassified = keys.filter((key) => CONTENT_FIELDS.has(key as keyof QRConfig) === isStyleField(key));
      expect(misclassified, 'Fix: add the key to STYLE_FIELDS in src/utils/styleFields.ts (with its rule) or to CONTENT_FIELDS in src/utils/brandTemplateManager.ts').toEqual([]);
    });

    it('keeps the luminance masking and animation settings through save, export and import', () => {
      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        isLuminanceMaskingEnabled: true,
        fgColorDark: '#112233',
        fgColorLight: '#eeddcc',
        luminanceThreshold: 0.4,
        animationFps: 12,
      };
      const saved = saveCustomTemplate('Masked', undefined, config);
      expect(saved.success).toBe(true);
      const exported = JSON.parse(JSON.stringify({ version: '1.0', type: 'qrcraftly-brand-template', template: saved.template }));
      const imported = validateTemplateJson(exported);
      expect(imported.valid).toBe(true);
      expect(imported.skipped).toBe(0);
      expect(imported.template?.config).toMatchObject({
        isLuminanceMaskingEnabled: true,
        fgColorDark: '#112233',
        fgColorLight: '#eeddcc',
        luminanceThreshold: 0.4,
        animationFps: 12,
      });
      expect(imported.template?.config).toEqual(saved.template?.config);
    });
  });
});
