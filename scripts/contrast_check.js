// Script to check WCAG contrast ratios for various UI elements in QRCraftly.
import fs from 'fs';
import { fileURLToPath } from 'url';

export function hexToRgb(hexColor) {
    hexColor = hexColor.replace(/^#/, '');
    if (hexColor.length === 3) {
        hexColor = hexColor.split('').map(c => c + c).join('');
    }
    return [
        parseInt(hexColor.slice(0, 2), 16),
        parseInt(hexColor.slice(2, 4), 16),
        parseInt(hexColor.slice(4, 6), 16)
    ];
}

export function luminance(rgb) {
    const a = rgb.map(x => {
        x /= 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

export function contrastRatio(rgb1, rgb2) {
    const lum1 = luminance(rgb1);
    const lum2 = luminance(rgb2);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
}

export function blendColor(fgRgb, bgRgb, alpha) {
    return fgRgb.map((fg, i) => Math.round(fg * alpha + bgRgb[i] * (1 - alpha)));
}

const colorsJsonUrl = new URL('../src/colors.json', import.meta.url);
const colorsJson = JSON.parse(fs.readFileSync(colorsJsonUrl, 'utf-8'));
export const colors = colorsJson.ui;
export const presets = colorsJson.presets;

export const scenarios = [
    // Light Mode
    {mode: 'Light', element: 'Page Background', bg: 'slate-50', fg: 'slate-900', text: 'H1 (About QRCraftly)', size: 'large'},
    {mode: 'Light', element: 'Page Background', bg: 'slate-50', fg: 'slate-600', text: 'Intro Paragraph', size: 'normal'},
    {mode: 'Light', element: 'Card', bg: 'white', fg: 'slate-900', text: 'Card H3', size: 'normal'},
    {mode: 'Light', element: 'Card', bg: 'white', fg: 'slate-600', text: 'Card Paragraph', size: 'normal'},
    {mode: 'Light', element: 'Icon Teal', bg: 'teal-100', fg: 'teal-700', text: 'Shield Icon', size: 'large'},
    {mode: 'Light', element: 'Icon Rose', bg: 'rose-100', fg: 'rose-700', text: 'Database Icon', size: 'large'},
    {mode: 'Light', element: 'License Section', bg: 'slate-50', fg: 'slate-900', text: 'License H2', size: 'large'},
    {mode: 'Light', element: 'License Section', bg: 'slate-50', fg: 'slate-600', text: 'License P', size: 'normal'},
    {mode: 'Light', element: 'Button', bg: 'white', fg: 'slate-700', text: 'Github Button (outline)', size: 'normal'},
    {mode: 'Light', element: 'Form Input', bg: 'white', fg: 'slate-600', text: 'Input Border', size: 'large'},
    {mode: 'Light', element: 'Toggle Switch', bg: 'white', fg: 'slate-600', text: 'Switch Track Inactive', size: 'large'},
    {mode: 'Light', element: 'Toggle Switch', bg: 'white', fg: 'teal-700', text: 'Switch Track Active', size: 'large'},
    {mode: 'Light', element: 'Focus Indicator', bg: 'white', fg: 'teal-700', text: 'Focus Ring', size: 'large'},
    {mode: 'Light', element: 'Focus Indicator', bg: 'slate-50', fg: 'teal-700', text: 'Focus Ring on page background', size: 'large'},

    // Dark Mode
    {mode: 'Dark', element: 'Page Background', bg: 'slate-900', fg: 'white', text: 'H1 (About QRCraftly)', size: 'large'},
    {mode: 'Dark', element: 'Page Background', bg: 'slate-900', fg: 'slate-300', text: 'Intro Paragraph', size: 'normal'},
    {mode: 'Dark', element: 'Card', bg: 'slate-800', fg: 'white', text: 'Card H3', size: 'normal'},
    {mode: 'Dark', element: 'Card', bg: 'slate-800', fg: 'slate-400', text: 'Card Paragraph', size: 'normal'},
    {mode: 'Dark', element: 'Icon Teal', bg: ['teal-900', 0.3, 'slate-800'], fg: 'teal-400', text: 'Shield Icon', size: 'large'},
    {mode: 'Dark', element: 'Icon Rose', bg: ['rose-900', 0.3, 'slate-800'], fg: 'rose-400', text: 'Database Icon', size: 'large'},
    {mode: 'Dark', element: 'License Section', bg: ['slate-800', 0.5, 'slate-900'], fg: 'white', text: 'License H2', size: 'large'},
    {mode: 'Dark', element: 'License Section', bg: ['slate-800', 0.5, 'slate-900'], fg: 'slate-300', text: 'License P', size: 'normal'},
    {mode: 'Dark', element: 'Button', bg: 'slate-800', fg: 'slate-300', text: 'Github Button (outline)', size: 'normal'},
    {mode: 'Dark', element: 'Form Input', bg: 'slate-900', fg: 'slate-400', text: 'Input Border', size: 'large'},
    {mode: 'Dark', element: 'Toggle Switch', bg: 'slate-900', fg: 'slate-400', text: 'Switch Track Inactive', size: 'large'},
    {mode: 'Dark', element: 'Toggle Switch', bg: 'slate-900', fg: 'teal-400', text: 'Switch Track Active', size: 'large'},
    {mode: 'Dark', element: 'Focus Indicator', bg: 'slate-900', fg: 'teal-400', text: 'Focus Ring', size: 'large'},
    {mode: 'Dark', element: 'Focus Indicator', bg: 'slate-800', fg: 'teal-400', text: 'Focus Ring on raised surface', size: 'large'},
    // Design tokens (src/layouts/index.css, #1045): text and non-text pairs in both themes
    {mode: 'Light', element: 'Token', bg: 'white', fg: 'slate-900', text: 'fg on surface', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'slate-50', fg: 'slate-700', text: 'fg-soft on page', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'slate-50', fg: 'slate-600', text: 'fg-muted on page', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'slate-100', fg: 'slate-900', text: 'fg on surface-hover (inline code)', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'slate-100', fg: 'slate-600', text: 'fg-muted on surface-hover', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'white', fg: 'teal-700', text: 'accent on surface', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'teal-50', fg: 'teal-700', text: 'accent on accent-soft', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'teal-50', fg: 'teal-800', text: 'accent-strong on accent-soft', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'teal-700', fg: 'white', text: 'on-action on action', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'teal-800', fg: 'white', text: 'on-action on action-hover', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'rose-700', fg: 'white', text: 'on-action on danger-action', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'white', fg: 'rose-700', text: 'danger on surface', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'rose-50', fg: 'rose-700', text: 'danger on danger-soft', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'emerald-50', fg: 'emerald-800', text: 'success on success-soft', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'amber-50', fg: 'amber-800', text: 'warning on warning-soft', size: 'normal'},
    {mode: 'Light', element: 'Token', bg: 'white', fg: 'slate-600', text: 'line-strong on surface (form borders)', size: 'large'},
    {mode: 'Dark', element: 'Token', bg: 'slate-900', fg: 'slate-100', text: 'fg on surface', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'slate-950', fg: 'slate-300', text: 'fg-soft on page', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'slate-950', fg: 'slate-400', text: 'fg-muted on page', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'slate-800', fg: 'slate-100', text: 'fg on surface-hover (inline code)', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'slate-800', fg: 'slate-400', text: 'fg-muted on surface-raised', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'slate-900', fg: 'teal-400', text: 'accent on surface', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'teal-950', fg: 'teal-400', text: 'accent on accent-soft', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'teal-950', fg: 'teal-300', text: 'accent-strong on accent-soft', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'teal-700', fg: 'white', text: 'on-action on action', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'teal-800', fg: 'white', text: 'on-action on action-hover', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'slate-900', fg: 'rose-400', text: 'danger on surface', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: ['rose-900', 0.3, 'slate-900'], fg: 'rose-400', text: 'danger on danger-soft', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: ['emerald-900', 0.3, 'slate-900'], fg: 'emerald-300', text: 'success on success-soft', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: ['amber-950', 0.3, 'slate-900'], fg: 'amber-400', text: 'warning on warning-soft', size: 'normal'},
    {mode: 'Dark', element: 'Token', bg: 'slate-900', fg: 'slate-400', text: 'line-strong on surface (form borders)', size: 'large'},
];
export function validateKeys(scenariosList, colorsDict) {
    const missingKeys = new Set();
    const safeScenarios = scenariosList || [];
    const safeColors = colorsDict || {};

    for (const s of safeScenarios) {
        if (s.fg && !(s.fg in safeColors)) {
            missingKeys.add(s.fg);
        }
        if (s.bg) {
            if (Array.isArray(s.bg)) {
                const overlayKey = s.bg[0];
                const baseKey = s.bg[2];
                if (overlayKey && !(overlayKey in safeColors)) {
                    missingKeys.add(overlayKey);
                }
                if (baseKey && !(baseKey in safeColors)) {
                    missingKeys.add(baseKey);
                }
            } else if (typeof s.bg === 'string') {
                if (!(s.bg in safeColors)) {
                    missingKeys.add(s.bg);
                }
            }
        }
    }
    return Array.from(missingKeys);
}

export function runCheck() {
    const missingKeys = validateKeys(scenarios, colors);
    if (missingKeys.length > 0) {
        console.error("Error: The following color keys referenced in contrast scenarios are missing from the colors dictionary:");
        missingKeys.forEach(key => console.error(` - ${key}`));
        process.exit(1);
    }

    console.log(`${'Mode'.padEnd(6)} | ${'Element'.padEnd(20)} | ${'Contrast'.padEnd(8)} | ${'Pass?'.padEnd(6)} | ${'Level'.padEnd(5)} | Details`);
    console.log("-".repeat(80));

    let allPassed = true;

    for (const s of scenarios) {
        let bgRgb;
        if (Array.isArray(s.bg)) {
            const overlayColor = s.bg[0];
            const opacity = s.bg[1];
            const baseColorName = s.bg[2];

            const overlayRgb = hexToRgb(colors[overlayColor]);
            const baseRgb = hexToRgb(colors[baseColorName]);

            bgRgb = blendColor(overlayRgb, baseRgb, opacity);
        } else {
            bgRgb = hexToRgb(colors[s.bg]);
        }

        const fgRgb = hexToRgb(colors[s.fg]);

        const ratio = contrastRatio(fgRgb, bgRgb);

        let minRatio = 4.5;
        if (s.size === 'large') {
            minRatio = 3.0;
        }

        const passed = ratio >= minRatio;
        if (!passed) allPassed = false;

        let aaaRatio = 7.0;
        if (s.size === 'large') {
            aaaRatio = 4.5;
        }
        const aaaPassed = ratio >= aaaRatio;

        let level = "Fail";
        if (aaaPassed) {
            level = "AAA";
        } else if (passed) {
            level = "AA";
        }

        const bgName = Array.isArray(s.bg) ? `[${s.bg.join(', ')}]` : s.bg;
        console.log(`${s.mode.padEnd(6)} | ${s.text.padEnd(20)} | ${ratio.toFixed(2)}:1   | ${(passed ? 'YES' : 'NO').padEnd(6)} | ${level.padEnd(5)} | ${bgName} vs ${s.fg}`);
    }

    console.log("\nChecking Presets:");
    console.log(`${'Preset'.padEnd(12)} | ${'Element'.padEnd(8)} | ${'Contrast'.padEnd(8)} | ${'Pass?'.padEnd(6)} | Details`);
    console.log("-".repeat(60));

    for (const p of presets) {
        const bgRgb = hexToRgb(p.bg);
        const fgRgb = hexToRgb(p.fg);
        const eyeRgb = hexToRgb(p.eye);

        const fgRatio = contrastRatio(fgRgb, bgRgb);
        const eyeRatio = contrastRatio(eyeRgb, bgRgb);

        const minRatio = 3.0; // Graphic elements generally require 3.0:1

        const fgPassed = fgRatio >= minRatio;
        const eyePassed = eyeRatio >= minRatio;

        if (!fgPassed || !eyePassed) allPassed = false;

        console.log(`${p.label.padEnd(12)} | ${'FG vs BG'.padEnd(8)} | ${fgRatio.toFixed(2)}:1   | ${(fgPassed ? 'YES' : 'NO').padEnd(6)} | ${p.bg} vs ${p.fg}`);
        console.log(`${p.label.padEnd(12)} | ${'Eye vs BG'.padEnd(8)} | ${eyeRatio.toFixed(2)}:1   | ${(eyePassed ? 'YES' : 'NO').padEnd(6)} | ${p.bg} vs ${p.eye}`);
    }
    
    if (!allPassed) {
        process.exit(1);
    }
}

// Only run automatically if executed directly
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('contrast_check.js'))) {
    runCheck();
}
