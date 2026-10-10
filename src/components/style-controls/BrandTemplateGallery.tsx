import React, { useState, useEffect } from 'react';
import { BookmarkPlus, Download, Upload, Trash2, Edit3, Check, Sparkles } from 'lucide-react';
import { QRConfig, BrandTemplate } from '../../types';
import { PREBUILT_TEMPLATES } from '../../data/brandTemplates';
import {
  getStoredTemplates,
  saveCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  validateTemplateJson,
  addImportedTemplate,
  isTemplateStorageAvailable,
  TEMPLATE_STORAGE_ERROR,
  exportTemplateToJson,
  applyTemplateToConfig,
  MAX_CUSTOM_TEMPLATES,
} from '../../utils/brandTemplateManager';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Tooltip } from '../ui/Tooltip';
import { Modal } from '../ui/Modal';
import { TextField } from '../ui/TextField';
import { useUndoToast } from '../../hooks/useUndoToast';

interface BrandTemplateGalleryProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

export const BrandTemplateGallery: React.FC<BrandTemplateGalleryProps> = ({ config, onChange }) => {
  const notifyUndo = useUndoToast();
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');
  const [customTemplates, setCustomTemplates] = useState<BrandTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Modal states
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // Feedback banner state
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [storageAvailable, setStorageAvailable] = useState(true);

  useEffect(() => {
    setStorageAvailable(isTemplateStorageAvailable());
    setCustomTemplates(getStoredTemplates());
  }, []);

  const showFeedback = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => {
      setFeedback(null);
    }, 4000);
  };

  const handleApply = (template: BrandTemplate) => {
    const styleUpdates = applyTemplateToConfig(config, template.config);
    onChange(styleUpdates);
    setSelectedId(template.id);
    showFeedback(`Applied "${template.name}" theme.`);
    notifyUndo(`Applied "${template.name}"`);
  };

  const handleOpenSaveModal = () => {
    setSaveName('');
    setSaveDescription('');
    setSaveError(null);
    setIsSaveModalOpen(true);
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    const result = saveCustomTemplate(saveName, saveDescription, config);
    if (!result.success) {
      setSaveError(result.error || 'Failed to save template.');
      return;
    }
    setCustomTemplates(getStoredTemplates());
    setIsSaveModalOpen(false);
    if (result.template) {
      setSelectedId(result.template.id);
    }
    setActiveTab('custom');
    showFeedback(`Saved "${saveName}" to custom templates!`);
  };

  const handleOpenRenameModal = (template: BrandTemplate) => {
    setRenameId(template.id);
    setRenameName(template.name);
    setRenameError(null);
    setIsRenameModalOpen(true);
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameId) return;
    setRenameError(null);
    const result = updateCustomTemplate(renameId, { name: renameName });
    if (!result.success) {
      setRenameError(result.error || 'Failed to rename template.');
      return;
    }
    setCustomTemplates(getStoredTemplates());
    setIsRenameModalOpen(false);
    setRenameId(null);
    showFeedback('Template renamed.');
  };

  const handleDelete = (template: BrandTemplate) => {
    const success = deleteCustomTemplate(template.id);
    if (success) {
      setCustomTemplates(getStoredTemplates());
      if (selectedId === template.id) setSelectedId(null);
      showFeedback(`Deleted "${template.name}".`);
    }
  };

  const handleExport = (template: BrandTemplate) => {
    exportTemplateToJson(template);
    showFeedback(`Exported "${template.name}" to JSON.`);
  };

  const processImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.target?.result ?? ''));
      } catch {
        showFeedback('Could not parse JSON file. Please ensure it is a valid template file.', 'error');
        return;
      }
      const validation = validateTemplateJson(parsed);
      if (!validation.valid || !validation.template) {
        showFeedback(validation.error || 'Invalid template JSON file.', 'error');
        return;
      }

      const result = addImportedTemplate(validation.template);
      if (!result.success) {
        showFeedback(result.error, 'error');
        return;
      }
      setCustomTemplates(result.templates);
      setActiveTab('custom');
      setSelectedId(validation.template.id);
      const skipped = validation.skipped ?? 0;
      const skippedNote = skipped > 0 ? ` ${skipped} ${skipped === 1 ? 'setting' : 'settings'} could not be used.` : '';
      showFeedback(`Imported template "${validation.template.name}"!${skippedNote}`);
    };
    reader.readAsText(file);
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        processImportFile(file);
      }
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle pb-3">
        <Button
          variant="primary"
          size="sm"
          onClick={handleOpenSaveModal}
          aria-label="Save current visual settings as brand template"
        >
          <BookmarkPlus className="size-4" />
          <span>Save as Template</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleImportClick}
          aria-label="Import template from JSON file"
        >
          <Upload className="size-4" />
          <span>Import JSON</span>
        </Button>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            feedback.type === 'error' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-strong'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Tab Switcher */}
      <SegmentedControl<'presets' | 'custom'>
        kind="tablist"
        label="Template collections"
        value={activeTab}
        onChange={setActiveTab}
        tabId={(tab) => `brand-templates-tab-${tab}`}
        controls={() => 'brand-templates-panel'}
        options={[
          { value: 'presets', label: `Curated Presets (${PREBUILT_TEMPLATES.length})` },
          { value: 'custom', label: `My Templates (${customTemplates.length}/${MAX_CUSTOM_TEMPLATES})` },
        ]}
      />

      {/* Gallery Cards Container */}
      <div
        id="brand-templates-panel"
        role="tabpanel"
        aria-labelledby={`brand-templates-tab-${activeTab}`}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {(activeTab === 'presets' ? PREBUILT_TEMPLATES : customTemplates).map((template) => {
          const isSelected = selectedId === template.id;
          const bg = template.config.bgColor || '#ffffff';
          const fg = template.config.fgColor || '#000000';
          const eyeFrame = template.config.eyeFrameColor || template.config.eyeColor || fg;
          const borderColor = template.config.borderColor || fg;
          const hasBorder = template.config.isBorderEnabled;

          return (
            <div
              key={template.id}
              className={`group relative flex flex-col justify-between rounded-xl border p-3 transition-all ${
                isSelected
                  ? 'border-teal-600 bg-teal-50/30 ring-2 ring-teal-600 dark:border-teal-400 dark:bg-teal-950/20 dark:ring-teal-400'
                  : 'border-line bg-surface hover:border-line'
              }`}
            >
              {/* Card Top: Swatch & Info */}
              <div className="flex items-start gap-3">
                {/* Visual Swatch */}
                <div
                  className="relative flex size-12 shrink-0 items-center justify-center rounded-lg border shadow-xs transition-transform group-hover:scale-105"
                  style={{
                    backgroundColor: bg,
                    borderColor: hasBorder ? borderColor : 'rgba(0,0,0,0.1)',
                    borderStyle: hasBorder ? template.config.borderStyle || 'solid' : 'solid',
                  }}
                  title={`Fg: ${fg}, Bg: ${bg}`}
                >
                  <div
                    className="flex size-7 flex-col justify-between rounded-sm p-0.5"
                    style={{ backgroundColor: fg }}
                  >
                    <div className="flex justify-between">
                      <div className="rounded-2xs size-1.5" style={{ backgroundColor: eyeFrame }} />
                      <div className="rounded-2xs size-1.5" style={{ backgroundColor: eyeFrame }} />
                    </div>
                    <div className="flex justify-start">
                      <div className="rounded-2xs size-1.5" style={{ backgroundColor: eyeFrame }} />
                    </div>
                  </div>
                </div>

                {/* Name & Metadata */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h4 className="truncate text-sm font-semibold text-fg">
                      {template.name}
                    </h4>
                    {isSelected && (
                      <Badge tone="brand">
                        <Check className="size-3" aria-hidden="true" /> Active
                      </Badge>
                    )}
                  </div>
                  {template.description && (
                    <p className="line-clamp-2 text-xs text-fg-muted">
                      {template.description}
                    </p>
                  )}
                  <Badge className="mt-1 capitalize">{template.config.style || 'standard'}</Badge>
                </div>
              </div>

              {/* Card Bottom: Actions */}
              <div className="mt-3 flex items-center justify-between border-t border-line-subtle pt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleApply(template)}
                  aria-label={`Apply ${template.name} template`}
                >
                  Apply
                </Button>

                <div className="flex items-center gap-1">
                  <Tooltip content="Export JSON">
                    <Button
                      variant="ghost"
                      iconOnly
                      size="sm"
                      onClick={() => handleExport(template)}
                      aria-label={`Export ${template.name} as JSON`}
                    >
                      <Download className="size-4" aria-hidden="true" />
                    </Button>
                  </Tooltip>

                  {!template.isPrebuilt && (
                    <>
                      <Tooltip content="Rename template">
                        <Button
                          variant="ghost"
                          iconOnly
                          size="sm"
                          onClick={() => handleOpenRenameModal(template)}
                          aria-label={`Rename ${template.name}`}
                        >
                          <Edit3 className="size-4" aria-hidden="true" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Delete template">
                        <Button
                          variant="danger"
                          iconOnly
                          size="sm"
                          onClick={() => handleDelete(template)}
                          aria-label={`Delete ${template.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {activeTab === 'custom' && customTemplates.length === 0 && (
          <EmptyState
            className="col-span-full"
            level={4}
            illustration={<Sparkles className="size-6" />}
            title={storageAvailable ? 'No custom templates saved yet.' : 'Custom templates are unavailable.'}
            body={
              storageAvailable
                ? 'Customize colors, patterns, and borders, then click "Save as Template" or import a team JSON file.'
                : TEMPLATE_STORAGE_ERROR
            }
            action={
              storageAvailable ? (
                <Button variant="outline" size="sm" onClick={handleOpenSaveModal}>
                  Save Current Style
                </Button>
              ) : undefined
            }
          />
        )}
      </div>

      {/* Save Template Modal */}
      <Modal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        title="Save Brand Template"
      >
        <form onSubmit={handleSaveSubmit} className="space-y-4">
          <p className="text-xs text-fg-muted">
            Save your active visual settings (colors, pattern style, borders, logo configuration) as a reusable template.
          </p>

          <TextField
            label="Template Name"
            placeholder="e.g. Acme Corporate Teal"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            maxLength={100}
            required
          />

          <div>
            <label htmlFor="template-description-input" className="mb-1 block text-xs font-medium text-fg-soft">
              Description (Optional)
            </label>
            <textarea
              id="template-description-input"
              className="w-full rounded-xl border border-line bg-surface-raised p-2.5 text-xs text-fg transition-colors focus:border-teal-600 focus:outline-hidden dark:focus:border-teal-400"
              rows={2}
              placeholder="e.g. Official brand colors for marketing campaigns"
              value={saveDescription}
              onChange={(e) => setSaveDescription(e.target.value)}
              maxLength={200}
            />
          </div>

          {saveError && (
            <p className="text-xs font-medium text-danger" role="alert">
              {saveError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsSaveModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit">
              Save Template
            </Button>
          </div>
        </form>
      </Modal>

      {/* Rename Template Modal */}
      <Modal
        isOpen={isRenameModalOpen}
        onClose={() => setIsRenameModalOpen(false)}
        title="Rename Template"
      >
        <form onSubmit={handleRenameSubmit} className="space-y-4">
          <TextField
            label="Template Name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            maxLength={100}
            required
          />

          {renameError && (
            <p className="text-xs font-medium text-danger" role="alert">
              {renameError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsRenameModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit">
              Update Name
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
