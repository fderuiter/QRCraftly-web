import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import {
  EyeShape,
  QRErrorCorrectionLevel,
  QRStyle,
  QRType,
  SocialFormat,
  TemplateStyle,
  type QRConfig,
} from '@/packages/core/types';
import { isStyleAtBaseline, resetStylePatch, STYLE_BASELINE } from './styleFields';

describe('resetStylePatch and isStyleAtBaseline', () => {
  it('treats DEFAULT_CONFIG and custom content payloads as baseline style', () => {
    expect(isStyleAtBaseline(DEFAULT_CONFIG)).toBe(true);
    expect(
      isStyleAtBaseline({
        ...DEFAULT_CONFIG,
        type: QRType.WIFI,
        value: 'WIFI:T:WPA;S:StudioNet;P:secret;;',
        borderText: 'Keep me',
        templateHeadline: 'Headline',
        templateSubtext: 'Subtext',
      })
    ).toBe(true);
  });

  it('detects customized visual properties, gradients, logos, images, and frame text', () => {
    const cases: Partial<QRConfig>[] = [
      { style: QRStyle.SWISS },
      { fgColor: '#1e293b' },
      { bgColor: 'transparent' },
      { gradientType: 'linear' },
      {
        gradientColorStops: [
          { offset: 0, color: '#000000' },
          { offset: 1, color: '#3b82f6' },
        ],
      },
      { errorCorrectionLevel: QRErrorCorrectionLevel.L },
      { isBorderEnabled: true },
      { socialFormat: SocialFormat.STORY_9_16 },
      { templateStyle: TemplateStyle.MINIMALIST },
      { eyeFrameShape: EyeShape.CIRCLE },
      { logoUrl: 'data:image/png;base64,AAA' },
      { borderLogoUrl: 'data:image/png;base64,BBB' },
      { backgroundImageUrl: 'data:image/png;base64,CCC' },
      { mosaicImageUrl: 'data:image/png;base64,DDD' },
      { frameText: 'SCAN ME' },
      { frameStyle: 'pill' },
    ];

    for (const override of cases) {
      expect(isStyleAtBaseline({ ...DEFAULT_CONFIG, ...override })).toBe(false);
    }
  });

  it('restores every STYLE_BASELINE field and clears media/frame text without touching content', () => {
    const patch = resetStylePatch();

    for (const [key, value] of Object.entries(STYLE_BASELINE)) {
      expect(Reflect.get(patch, key)).toEqual(value);
    }
    expect(patch.logoUrl).toBeNull();
    expect(patch.borderLogoUrl).toBeNull();
    expect(patch.backgroundImageUrl).toBeNull();
    expect(patch.mosaicImageUrl).toBeNull();
    expect(patch.frameText).toBe('');

    for (const contentKey of ['type', 'value', 'borderText', 'templateHeadline', 'templateSubtext']) {
      expect(patch).not.toHaveProperty(contentKey);
    }

    const customized: QRConfig = {
      ...DEFAULT_CONFIG,
      type: QRType.WIFI,
      value: 'WIFI:T:WPA;S:Office;P:pw;;',
      borderText: 'Guest Wi-Fi',
      templateHeadline: 'Welcome',
      templateSubtext: 'Scan to connect',
      style: QRStyle.MODERN,
      fgColor: '#334155',
      bgColor: '#f8fafc',
      eyeColor: '#0f172a',
      eyeFrameColor: '#ef4444',
      eyeBallColor: '#3b82f6',
      eyeFrameShape: EyeShape.LEAF,
      eyeBallShape: EyeShape.CIRCLE,
      gradientType: 'radial',
      gradientColorStops: [
        { offset: 0, color: '#334155' },
        { offset: 1, color: '#94a3b8' },
      ],
      gradientAngle: 135,
      isBorderEnabled: true,
      borderSize: 0.1,
      socialFormat: SocialFormat.PORTRAIT_4_5,
      templateStyle: TemplateStyle.SOLID_FRAME,
      templateBgColor: '#111827',
      templateTextColor: '#ffffff',
      logoUrl: 'data:image/png;base64,LOGO',
      borderLogoUrl: 'data:image/png;base64,BORDER',
      backgroundImageUrl: 'data:image/png;base64,BG',
      mosaicImageUrl: 'data:image/png;base64,MOSAIC',
      frameStyle: 'banner',
      frameText: 'CONNECT',
    };

    const reset: QRConfig = { ...customized, ...patch };
    expect(isStyleAtBaseline(reset)).toBe(true);
    expect(reset.type).toBe(QRType.WIFI);
    expect(reset.value).toBe('WIFI:T:WPA;S:Office;P:pw;;');
    expect(reset.borderText).toBe('Guest Wi-Fi');
    expect(reset.templateHeadline).toBe('Welcome');
    expect(reset.templateSubtext).toBe('Scan to connect');
  });
});
