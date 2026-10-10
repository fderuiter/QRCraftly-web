import { describe, it, expect } from 'vitest';
import { validateConfig } from '../index';
import { type QRConfig, QRType, QRErrorCorrectionLevel, SocialFormat, TemplateStyle, QRStyle } from '@/types';

const getBaseConfig = (): QRConfig => ({
  type: QRType.TEXT,
  value: 'hello world',
  fgColor: '#000000',
  bgColor: '#FFFFFF',
  eyeColor: '#000000',
  errorCorrectionLevel: QRErrorCorrectionLevel.M,
  logoUrl: '',
  logoSize: 0.2,
  logoPadding: 0,
  logoPaddingStyle: 'square',
  logoBackgroundColor: '#FFFFFF',
  style: QRStyle.STANDARD,
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
  isBorderEnabled: false,
  borderSize: 0.05,
  borderStyle: 'solid',
  borderColor: '#000000',
  borderText: '',
  borderTextColor: '#000000',
  borderLogoUrl: null,
  borderTextPosition: 'bottom-center',
  borderLogoPosition: 'bottom-center',
});

describe('validateConfig', () => {
  describe('containment and structure checks', () => {
    it('should pass valid configurations', () => {
      const config = getBaseConfig();
      const violations = validateConfig(config);
      expect(violations).toHaveLength(0);
    });

    it('should reject zero-width characters in border text', () => {
      const config = getBaseConfig();
      config.borderText = 'Hello\u200BWorld'; // Zero-width space
      const violations = validateConfig(config);
      expect(violations).toContain('Border Text contains invalid control or zero-width characters');
    });

    it('should reject zero-width characters in template headline', () => {
      const config = getBaseConfig();
      config.templateHeadline = 'Hello\uFEFFWorld'; // Byte order mark
      const violations = validateConfig(config);
      expect(violations).toContain('Template Headline contains invalid control or zero-width characters');
    });

    it('should reject dangerous URLs', () => {
      const config = getBaseConfig();
      config.type = QRType.URL;
      config.value = 'javascript:alert(1)';
      const violations = validateConfig(config);
      expect(violations).toContain('URI_INJECTION_VIOLATION');
    });

    it('should reject malformed URLs violating the containment profile', () => {
      const config = getBaseConfig();
      config.type = QRType.URL;
      config.value = 'http://safe.com/ \x00'; // Contains null character
      const violations = validateConfig(config);
      // It should either fail control char check or URL structure check
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should reject malformed emails violating the containment profile', () => {
      const config = getBaseConfig();
      config.type = QRType.EMAIL;
      config.value = 'mailto:invalid@@email..com';
      const violations = validateConfig(config);
      expect(violations).toContain('EMAIL_STRUCTURE_VIOLATION');
    });

    it('should reject out-of-range latitude in location configs', () => {
      const config = getBaseConfig();
      config.type = QRType.LOCATION;
      config.value = 'geo:110,-74';
      const violations = validateConfig(config);
      expect(violations).toContain('LATITUDE_OUT_OF_BOUNDS_VIOLATION');
      expect(violations).not.toContain('LONGITUDE_OUT_OF_BOUNDS_VIOLATION');
    });

    it('should reject out-of-range longitude in location configs', () => {
      const config = getBaseConfig();
      config.type = QRType.LOCATION;
      config.value = 'geo:40,-195';
      const violations = validateConfig(config);
      expect(violations).toContain('LONGITUDE_OUT_OF_BOUNDS_VIOLATION');
      expect(violations).not.toContain('LATITUDE_OUT_OF_BOUNDS_VIOLATION');
    });

    it('should pass valid latitude and longitude in location configs', () => {
      const config = getBaseConfig();
      config.type = QRType.LOCATION;
      config.value = 'geo:40,-74';
      const violations = validateConfig(config);
      expect(violations).toHaveLength(0);
    });

    it('should safely handle malicious or invalid QRType without throwing or invoking prototype methods', () => {
      const config = getBaseConfig();
      config.type = 'toString' as QRType;
      expect(() => {
        const violations = validateConfig(config);
        expect(violations).toBeDefined();
      }).not.toThrow();
    });
  });
});
