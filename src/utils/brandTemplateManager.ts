import { BrandTemplate, BrandTemplateExportPayload, QRConfig, QRStyle, QRErrorCorrectionLevel } from '../types';
import { normalizeHex } from './colorUtils';

/** Approved storage key for user-saved brand templates. */
export const BRAND_TEMPLATES_STORAGE_KEY = 'qrcraftly:brand-templates';

/** Maximum allowed custom templates in browser persistent storage. */
export const MAX_CUSTOM_TEMPLATES = 50;

/**
 * Fields that carry QR content, user input text or user-uploaded images.
 * MUST NEVER be overwritten by applying a template or saved in template style configs.
 * Uploaded images stay in volatile memory only (docs/public/COMPLIANCE.md), so a
 * template never persists or imports a logo, border logo, background or mosaic image.
 */
export const CONTENT_FIELDS: ReadonlySet<keyof QRConfig> = new Set<keyof QRConfig>([
  'value',
  'type',
  'animationValues',
  'isAnimating',
  'borderText',
  'templateHeadline',
  'templateSubtext',
  'logoUrl',
  'borderLogoUrl',
  'backgroundImageUrl',
  'mosaicImageUrl',
]);

/**
 * Extracts visual style parameters from a QRConfig, stripping all content/payload fields.
 * @param config - Full QRConfig.
 * @returns Partial QRConfig with visual style properties only.
 */
export function extractStyleConfig(config: QRConfig): Partial<QRConfig> {
  const styleConfig: Partial<QRConfig> = {};
  const keys = Object.keys(config) as (keyof QRConfig)[];
  for (const key of keys) {
    if (!CONTENT_FIELDS.has(key)) {
      (styleConfig as Record<string, unknown>)[key] = config[key];
    }
  }
  return styleConfig;
}

/**
 * Merges a template's style config into an existing QRConfig, strictly preserving active content fields.
 * @param currentConfig - Active QRConfig containing user content.
 * @param templateConfig - Visual style properties to apply.
 * @returns Partial QRConfig updates to pass to updateConfig.
 */
export function applyTemplateToConfig(
  currentConfig: QRConfig,
  templateConfig: Partial<QRConfig>
): Partial<QRConfig> {
  const updates: Partial<QRConfig> = {};
  const keys = Object.keys(templateConfig) as (keyof QRConfig)[];
  for (const key of keys) {
    if (!CONTENT_FIELDS.has(key)) {
      (updates as Record<string, unknown>)[key] = templateConfig[key];
    }
  }
  return updates;
}

/**
 * Loads user-saved custom brand templates from browser local storage.
 * @returns Array of custom BrandTemplates.
 */
export function getStoredTemplates(): BrandTemplate[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem('qrcraftly:brand-templates');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string');
  } catch {
    return [];
  }
}

/**
 * Saves custom brand templates array to local storage.
 * @param templates - Array of templates.
 */
function setStoredTemplates(templates: BrandTemplate[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem('qrcraftly:brand-templates', JSON.stringify(templates));
  } catch (err) {
    console.error('Failed to save brand templates to localStorage:', err);
  }
}

/**
 * Saves active visual config as a new custom brand template.
 * Caps custom storage at 50 templates.
 * @param name - Template name.
 * @param description - Optional description.
 * @param currentConfig - Current QRConfig.
 * @returns Object with success status, saved template, or error message.
 */
export function saveCustomTemplate(
  name: string,
  description: string | undefined,
  currentConfig: QRConfig
): { success: boolean; template?: BrandTemplate; error?: string } {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { success: false, error: 'Template name cannot be empty.' };
  }
  if (trimmedName.length > 100) {
    return { success: false, error: 'Template name must be 100 characters or fewer.' };
  }

  const existing = getStoredTemplates();
  if (existing.length >= MAX_CUSTOM_TEMPLATES) {
    return {
      success: false,
      error: `Storage limit reached (${MAX_CUSTOM_TEMPLATES} templates max). Please delete an existing template first.`,
    };
  }

  const styleConfig = extractStyleConfig(currentConfig);
  const now = new Date().toISOString();
  const id = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const newTemplate: BrandTemplate = {
    id,
    name: trimmedName,
    description: description ? description.trim().substring(0, 200) : undefined,
    createdAt: now,
    updatedAt: now,
    isPrebuilt: false,
    config: styleConfig,
  };

  const updated = [newTemplate, ...existing];
  setStoredTemplates(updated);

  return { success: true, template: newTemplate };
}

/**
 * Updates an existing custom template name, description, or style config.
 * @param id - Template ID to update.
 * @param updates - Name, description, or new config.
 * @returns Success status and updated template.
 */
export function updateCustomTemplate(
  id: string,
  updates: { name?: string; description?: string; config?: Partial<QRConfig> }
): { success: boolean; template?: BrandTemplate; error?: string } {
  const existing = getStoredTemplates();
  const index = existing.findIndex(t => t.id === id);
  if (index === -1) {
    return { success: false, error: 'Template not found.' };
  }

  const target = existing[index];
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) return { success: false, error: 'Template name cannot be empty.' };
    target.name = trimmed.substring(0, 100);
  }
  if (updates.description !== undefined) {
    target.description = updates.description.trim().substring(0, 200);
  }
  if (updates.config) {
    target.config = { ...target.config, ...extractStyleConfig(updates.config as QRConfig) };
  }
  target.updatedAt = new Date().toISOString();

  existing[index] = target;
  setStoredTemplates(existing);

  return { success: true, template: target };
}

/**
 * Deletes a custom template from local storage.
 * @param id - Template ID to delete.
 * @returns True if deleted successfully.
 */
export function deleteCustomTemplate(id: string): boolean {
  const existing = getStoredTemplates();
  const filtered = existing.filter(t => t.id !== id);
  if (filtered.length === existing.length) return false;
  setStoredTemplates(filtered);
  return true;
}

/**
 * Validates an imported JSON object against the strict BrandTemplate schema.
 * Prevents dynamic injection and ensures color/enum validity.
 * @param data - Raw parsed JSON data.
 * @returns Validation result with cleaned BrandTemplate or error message.
 */
export function validateTemplateJson(
  data: unknown
): { valid: boolean; template?: BrandTemplate; error?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid file: JSON root must be an object.' };
  }

  const rawObj = data as Record<string, unknown>;
  let templateObj: Record<string, unknown> | null = null;

  if (rawObj.type === 'qrcraftly-brand-template' && rawObj.template && typeof rawObj.template === 'object') {
    templateObj = rawObj.template as Record<string, unknown>;
  } else if (typeof rawObj.name === 'string' && rawObj.config && typeof rawObj.config === 'object') {
    templateObj = rawObj;
  }

  if (!templateObj) {
    return { valid: false, error: 'Invalid template file format: Missing template object or required fields.' };
  }

  const name = typeof templateObj.name === 'string' ? templateObj.name.trim() : '';
  if (!name) {
    return { valid: false, error: 'Invalid template: Missing or empty name field.' };
  }

  const rawConfig = templateObj.config;
  if (!rawConfig || typeof rawConfig !== 'object') {
    return { valid: false, error: 'Invalid template: Missing or invalid visual config object.' };
  }

  const validConfig: Partial<QRConfig> = {};
  const validStyles = Object.values(QRStyle) as string[];
  const validEcl = Object.values(QRErrorCorrectionLevel) as string[];

  // Sanitize and validate visual properties inside rawConfig
  const keys = Object.keys(rawConfig as object) as (keyof QRConfig)[];
  for (const key of keys) {
    // Strictly block non-style payload content fields
    if (CONTENT_FIELDS.has(key)) continue;

    const val = (rawConfig as Record<string, unknown>)[key];
    if (val === undefined || val === null) continue;

    // Validate color strings if key end with 'Color'
    if (typeof key === 'string' && key.toLowerCase().endsWith('color') && typeof val === 'string') {
      const normalized = normalizeHex(val);
      if (normalized) {
        (validConfig as Record<string, unknown>)[key] = normalized;
      }
      continue;
    }

    if (key === 'style' && typeof val === 'string') {
      if (validStyles.includes(val)) {
        validConfig.style = val as QRStyle;
      }
      continue;
    }

    if (key === 'errorCorrectionLevel' && typeof val === 'string') {
      if (validEcl.includes(val)) {
        validConfig.errorCorrectionLevel = val as QRErrorCorrectionLevel;
      }
      continue;
    }

    // Allow booleans and numbers for valid style fields
    if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') {
      (validConfig as Record<string, unknown>)[key] = val;
    }
  }

  const now = new Date().toISOString();
  const cleanedTemplate: BrandTemplate = {
    id: `imported-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    name: name.substring(0, 100),
    description: typeof templateObj.description === 'string' ? templateObj.description.substring(0, 200) : undefined,
    createdAt: typeof templateObj.createdAt === 'string' ? templateObj.createdAt : now,
    updatedAt: now,
    isPrebuilt: false,
    config: validConfig,
  };

  return { valid: true, template: cleanedTemplate };
}

/**
 * Downloads a BrandTemplate as a structured JSON file.
 * @param template - Template to export.
 */
export function exportTemplateToJson(template: BrandTemplate): void {
  const payload: BrandTemplateExportPayload = {
    version: '1.0',
    type: 'qrcraftly-brand-template',
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      isPrebuilt: template.isPrebuilt,
      config: template.config,
    },
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const slug = template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'brand-template';
  const fileName = `${slug}.qrcraftly.json`;

  const link = document.createElement('a');
  // nosemgrep: require-isdangerousurl -- a Blob URL made by URL.createObjectURL, never user text
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
