import { BrandTemplate, BrandTemplateExportPayload, QRConfig } from '../types';
import { isStyleField, pickStyle } from './styleFields';

/** Approved storage key for user-saved brand templates. */
export const BRAND_TEMPLATES_STORAGE_KEY = 'qrcraftly:brand-templates';

/** Maximum allowed custom templates in browser persistent storage. */
export const MAX_CUSTOM_TEMPLATES = 50;

/** Shown when the browser blocks or fills site storage, so templates cannot be kept. */
export const TEMPLATE_STORAGE_ERROR =
  'Your browser is blocking or has filled site storage, so templates cannot be saved here.';

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
  'frameText',
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
 * Returns the browser's local storage, or null when there is none or the browser blocks it.
 * With site data blocked, merely reading `window.localStorage` throws `SecurityError`.
 * @returns The storage object, or null.
 */
function templateStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Reports whether custom templates can be read and saved in this browser.
 * @returns False when site storage is unavailable or blocked.
 */
export function isTemplateStorageAvailable(): boolean {
  return templateStorage() !== null;
}

/**
 * Loads user-saved custom brand templates from browser local storage.
 * @returns Array of custom BrandTemplates; empty when storage is unavailable.
 */
export function getStoredTemplates(): BrandTemplate[] {
  try {
    const raw = templateStorage()?.getItem(BRAND_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string');
  } catch {
    return [];
  }
}

/**
 * Saves custom brand templates array to local storage.
 * @param templates - Array of templates.
 * @returns True when the templates were stored.
 */
function setStoredTemplates(templates: BrandTemplate[]): boolean {
  const storage = templateStorage();
  if (!storage) return false;
  try {
    storage.setItem(BRAND_TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch (err) {
    console.error('Failed to save brand templates to localStorage:', err);
    return false;
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

  if (!setStoredTemplates([newTemplate, ...existing])) {
    return { success: false, error: TEMPLATE_STORAGE_ERROR };
  }

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
  if (!setStoredTemplates(existing)) {
    return { success: false, error: TEMPLATE_STORAGE_ERROR };
  }

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
  return setStoredTemplates(filtered);
}

/**
 * Adds an imported template to the front of the stored templates.
 * @param template - Template returned by `validateTemplateJson`.
 * @returns The updated list, or an error when the quota is reached or storage fails.
 */
export function addImportedTemplate(
  template: BrandTemplate
): { success: true; templates: BrandTemplate[] } | { success: false; error: string } {
  const existing = getStoredTemplates();
  if (existing.length >= MAX_CUSTOM_TEMPLATES) {
    return { success: false, error: `Storage quota reached (${MAX_CUSTOM_TEMPLATES} templates max).` };
  }
  const templates = [template, ...existing];
  if (!setStoredTemplates(templates)) {
    return { success: false, error: TEMPLATE_STORAGE_ERROR };
  }
  return { success: true, templates };
}

/**
 * Validates an imported JSON object against the strict BrandTemplate schema.
 * Config values go through the same style rules as style files: content fields, unknown keys
 * and values outside the rules are dropped, so a hand-edited or newer file cannot break the
 * generator.
 * @param data - Raw parsed JSON data.
 * @returns Validation result with cleaned BrandTemplate (and how many settings were dropped)
 * or error message.
 */
export function validateTemplateJson(
  data: unknown
): { valid: boolean; template?: BrandTemplate; error?: string; skipped?: number } {
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

  // Content fields are dropped silently; other keys must pass the style rules or are skipped.
  const configObj = rawConfig as Record<string, unknown>;
  const { style: validConfig, skipped: invalid } = pickStyle(configObj);
  const unknown = Object.keys(configObj).filter(
    key => !CONTENT_FIELDS.has(key as keyof QRConfig) && !isStyleField(key)
  ).length;

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

  return { valid: true, template: cleanedTemplate, skipped: invalid + unknown };
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
