export const BASE_INPUT_CLASSES = "bg-surface border border-line-strong rounded-lg text-fg text-sm transition-all w-full placeholder-fg-muted";

/**
 * Unified Layout Spacing & Structure Variables
 */
export const FIELDSET_CLASSES = "space-y-4 min-w-0";
export const LEGEND_CLASSES = "text-sm font-semibold text-fg-soft w-full mb-3";
export const CONTAINER_SPACING_CLASSES = "space-y-3";
export const GRID_TWO_COLUMNS_CLASSES = "grid grid-cols-2 gap-4";
export const SUB_FIELDSET_CLASSES = "pt-2 border-t border-line-subtle min-w-0";
export const SUB_LEGEND_CLASSES = "block text-sm font-bold text-fg-muted mb-2 w-full";
export const SUB_CONTAINER_SPACING_CLASSES = "space-y-4";

export const TEXT_FIELD_CLASSES = `${BASE_INPUT_CLASSES} px-3 py-2`;
export const TEXT_AREA_CLASSES = `${BASE_INPUT_CLASSES} font-sans px-4 py-2`;
export const SELECT_CLASSES = `${BASE_INPUT_CLASSES} font-mono px-3 py-2`;
export const ERROR_INPUT_CLASSES = "border-danger";

/** Tailwind font-size utilities: named steps plus arbitrary bracketed pixel or rem sizes. */
const TEXT_SIZE_PATTERN = /^text-(xs|sm|base|lg|xl|\d+xl|\[\d[^\]]*\])$/;
const TEXT_ALIGN_PATTERN = /^text-(left|center|right|justify|start|end)$/;
const TEXT_WRAP_PATTERN = /^text-(wrap|nowrap|balance|pretty)$/;
const TEXT_OVERFLOW_PATTERN = /^text-(ellipsis|clip)$/;
const FONT_FAMILY_PATTERN = /^font-(sans|serif|mono|display)$/;
const BORDER_WIDTH_PATTERN = /^border(-[xytrbl])?(-(\d+|\[[^\]]+\]))?$/;
const BORDER_STYLE_PATTERN = /^border-(solid|dashed|dotted|double|hidden|none)$/;

/**
 * Splits `text-*` utilities into the properties they actually set, so a size such as
 * `text-sm` and a colour such as `text-slate-700` both survive a merge.
 * @param baseClass A `text-*` class without modifiers.
 * @returns The conflict group for the class.
 */
function textGroup(baseClass: string): string {
  if (TEXT_SIZE_PATTERN.test(baseClass)) return 'text-size';
  if (TEXT_ALIGN_PATTERN.test(baseClass)) return 'text-align';
  if (TEXT_WRAP_PATTERN.test(baseClass)) return 'text-wrap';
  if (TEXT_OVERFLOW_PATTERN.test(baseClass)) return 'text-overflow';
  return 'text-color';
}

/**
 * Merges Tailwind classes and resolves overrides.
 * Last-one-wins for conflicting classes within the same prefix category/modifier.
 * @param inputs The input classes to merge.
 * @returns The merged and resolved class string.
 */
export function mergeClasses(...inputs: (string | undefined | null | false)[]): string {
  const resolved: Record<string, string> = {};

  for (const input of inputs) {
    if (!input) continue;
    const classes = input.trim().split(/\s+/);

    for (const cls of classes) {
      if (!cls) continue;

      // Extract modifiers (e.g. "dark:hover:")
      const parts = cls.split(':');
      const baseClass = parts[parts.length - 1];
      const modifiers = parts.slice(0, parts.length - 1).join(':') + (parts.length > 1 ? ':' : '');

      let group: string | null = null;

      if (baseClass.startsWith('px-')) {
        group = 'px';
      } else if (baseClass.startsWith('py-')) {
        group = 'py';
      } else if (baseClass.startsWith('pl-')) {
        group = 'pl';
      } else if (baseClass.startsWith('pr-')) {
        group = 'pr';
      } else if (baseClass.startsWith('pt-')) {
        group = 'pt';
      } else if (baseClass.startsWith('pb-')) {
        group = 'pb';
      } else if (baseClass.startsWith('p-')) {
        group = 'p';
      } else if (baseClass.startsWith('mx-')) {
        group = 'mx';
      } else if (baseClass.startsWith('my-')) {
        group = 'my';
      } else if (baseClass.startsWith('ml-')) {
        group = 'ml';
      } else if (baseClass.startsWith('mr-')) {
        group = 'mr';
      } else if (baseClass.startsWith('mt-')) {
        group = 'mt';
      } else if (baseClass.startsWith('mb-')) {
        group = 'mb';
      } else if (baseClass.startsWith('m-')) {
        group = 'm';
      } else if (baseClass.startsWith('bg-')) {
        group = 'bg';
      } else if (baseClass.startsWith('text-')) {
        group = textGroup(baseClass);
      } else if (baseClass.startsWith('font-')) {
        group = FONT_FAMILY_PATTERN.test(baseClass) ? 'font-family' : 'font-weight';
      } else if (baseClass.startsWith('rounded-') || baseClass === 'rounded') {
        group = 'rounded';
      } else if (baseClass.startsWith('placeholder-')) {
        group = 'placeholder';
      } else if (baseClass.startsWith('w-')) {
        group = 'w';
      } else if (baseClass.startsWith('h-')) {
        group = 'h';
      } else if (baseClass.startsWith('transition-') || baseClass === 'transition') {
        group = 'transition';
      } else if (baseClass.startsWith('border-') || baseClass === 'border') {
        // Distinguish border width (per side) and style from border colour (palette or semantic token).
        if (BORDER_STYLE_PATTERN.test(baseClass)) {
          group = 'border-style';
        } else if (BORDER_WIDTH_PATTERN.test(baseClass)) {
          if (baseClass.startsWith('border-t')) group = 'border-t';
          else if (baseClass.startsWith('border-b')) group = 'border-b';
          else if (baseClass.startsWith('border-l')) group = 'border-l';
          else if (baseClass.startsWith('border-r')) group = 'border-r';
          else if (baseClass.startsWith('border-x')) group = 'border-x';
          else if (baseClass.startsWith('border-y')) group = 'border-y';
          else group = 'border-width';
        } else {
          group = 'border-color';
        }
      }

      if (group) {
        const key = `${modifiers}${group}`;
        resolved[key] = cls;
      } else {
        resolved[`raw:${cls}`] = cls;
      }
    }
  }

  return Object.values(resolved).join(' ');
}
