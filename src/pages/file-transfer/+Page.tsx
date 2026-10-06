/*
    QRCraftly
    Copyright (C) 2025 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import React from 'react';
import { Play, Square, Pause, Upload, FileUp, FolderUp, Cpu, Sliders, Activity } from 'lucide-react';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Progress } from '@/components/ui/Progress';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Card } from '@/components/ui/Card';
import { RangeInput } from '@/components/ui/RangeInput';
import { Alert } from '@/components/ui/Alert';
import { AccordionItem } from '@/components/ui/Accordion';
import { PairingGuide } from '@/components/transfer/PairingGuide';
import { TRANSFER_SPEEDS, formatFileSize, formatShortDuration, matchTransferSpeed } from '@/utils/transferSpeed';
import { EmptyState } from '@/components/ui/EmptyState';
import { BetaNotice } from '@/components/BetaNotice';
import { QrIllustration } from '@/components/QrIllustration';
import { ToolWorkspaceLayout, ToolWorkspaceHeader } from '@/components/ToolWorkspaceLayout';
import { TransferModeSwitcher } from '@/components/TransferModeSwitcher';
import { useOpticalSender } from '@/packages/optical-transfer/client';
import {
  MULTI_RATE_PROFILES,
  estimateTransferFrames,
  neededSymbols,
  type FeedbackLinkState,
  type MultiRateProfileName,
  type TransferDensity,
} from '@/packages/optical-transfer';
import { paintTransferFrame } from './paintTransferFrame';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import {
  PAUSED_ANNOUNCEMENT,
  PAUSE_HINT,
  PHOTOSENSITIVITY_NOTICE,
  REDUCED_MOTION_CONFIRM_BODY,
  REDUCED_MOTION_CONFIRM_TITLE,
} from '@/utils/photosensitivity';

/**
 * Set when the first transfer of this page visit starts, so the photosensitivity notice shows only
 * once per visit. Kept in memory: nothing is stored, and a reload shows the notice again.
 */
let photosensitivityNoticeSeen = false;

/** `webkitdirectory` is not in React's input types; browsers that support it list the picked folder's files. */
const FOLDER_INPUT_PROPS: React.InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string } = { webkitdirectory: '' };

const DENSITY_OPTIONS: ReadonlyArray<{ value: TransferDensity; label: string; hint: string }> = [
  { value: 'reliable', label: 'Reliable', hint: 'Small QR codes for older phones, dim rooms or a shaky hand.' },
  { value: 'balanced', label: 'Balanced', hint: 'Medium QR codes. Works for most phones held steady.' },
  { value: 'fast', label: 'Fast', hint: 'Large QR codes. Needs a sharp camera close to a bright screen.' },
];

/**
 * Formats a duration in seconds as a rough, human-readable estimate.
 * @param seconds Duration in seconds.
 * @returns For example "about 40 seconds" or "about 12 minutes".
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    const whole = Math.max(1, Math.round(seconds));
    return `about ${whole} second${whole === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `about ${(seconds / 3600).toFixed(1)} hours`;
}

/**
 * Opens this device's webcam for the back channel (#1146): the front camera, at a size that reads a
 * small code across a desk. Called only after the person turned steering on and started a transfer.
 * @returns The camera stream.
 */
function openSenderWebcam(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
}

/**
 * What the sender says about the back channel while it sends.
 * @param state - The back channel's state.
 * @param profile - The profile on screen.
 * @param receivers - Receivers whose code the camera reads.
 * @returns One sentence.
 */
function steerMessage(state: FeedbackLinkState, profile: MultiRateProfileName | null, receivers: number): string {
  if (state.status === 'requesting') return 'Asking for the camera so the receiver can steer the speed.';
  if (state.status === 'listening') {
    const speed = profile ? `${MULTI_RATE_PROFILES[profile].label} speed` : 'The chosen speed';
    if (receivers === 0) return `${speed}. Point this device’s camera at the receiving screen’s small code.`;
    return `${speed}, steered by ${receivers} receiver${receivers === 1 ? '' : 's'}.`;
  }
  if (state.status === 'one-way') {
    const why =
      state.reason === 'denied'
        ? 'Camera access was refused'
        : state.reason === 'unavailable'
          ? 'No camera was found'
          : state.reason === 'camera-lost'
            ? 'The camera stopped'
            : 'The camera could not start';
    return `${why}, so this transfer runs at the speed you chose and does not stop by itself.`;
  }
  return '';
}

/**
 * Button handlers that show something only while the button is held, by pointer or with Space or
 * Enter, and hide it when the button is let go or loses focus.
 * @param show - Shows it.
 * @param hide - Hides it.
 * @returns Props for a `Button`.
 */
function holdToShow(show: () => void, hide: () => void) {
  return {
    onPointerDown: show,
    onPointerUp: hide,
    onPointerLeave: hide,
    onPointerCancel: hide,
    onBlur: hide,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) show();
    },
    onKeyUp: hide,
  };
}

/**
 * High-Performance Animated QR File Transfer Tool - Sender only view
 * @returns The FileTransferToolInner component.
 */
function FileTransferToolInner() {
  const [isDraggingFile, setIsDraggingFile] = React.useState(false);
  // The key words show only while their button is held, never beside the stream by default.
  const [showingKeyCode, setShowingKeyCode] = React.useState(false);

  // Hook into the unified animated QR sender
  const {
    selectedFile,
    selectedFiles,
    setSelectedFiles,
    isPrivate,
    setIsPrivate,
    keyFrame,
    keyCanvasRef,
    showKeyQr,
    hideKeyQr,
    isTransferring,
    isPaused,
    isVerifyingHandshake,
    settingsLocked,
    handshakeError,
    progress,
    currentFrameIndex,
    totalFrames,
    density,
    setDensity,
    outerCode,
    setOuterCode,
    multiCode,
    setMultiCode,
    tileInfo,
    steer,
    setSteer,
    steerState,
    steeredProfile,
    steeringReceivers,
    autoStopped,
    walletCompat,
    setWalletCompat,
    fps,
    setFps,
    currentPass,
    fountainInfo,
    transferStats,
    canvasRef,
    startTransfer,
    stopTransfer,
    pauseTransfer,
    resumeTransfer,
    handleFileChange,
    simulate50MBFile,
  } = useOpticalSender({
    renderFrame: paintTransferFrame,
    requestWebcam: openSenderWebcam,
  });

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const folderInputRef = React.useRef<HTMLInputElement | null>(null);
  // Only some browsers can pick a folder; the button appears once the page knows.
  const [folderSupported, setFolderSupported] = React.useState(false);
  React.useEffect(() => {
    setFolderSupported('webkitdirectory' in document.createElement('input'));
  }, []);

  // Photosensitivity safeguards (#1148).
  const reducedMotion = usePrefersReducedMotion();
  const [noticeSeen, setNoticeSeen] = React.useState(photosensitivityNoticeSeen);
  const [confirmingMotion, setConfirmingMotion] = React.useState(false);
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);

  // Reduced motion starts at the slowest pace.
  React.useEffect(() => {
    if (!reducedMotion) return;
    const slowest = TRANSFER_SPEEDS[0];
    setDensity(slowest.density);
    setFps(slowest.fps);
  }, [reducedMotion, setDensity, setFps]);

  // Escape stops the flashing at once, wherever focus is.
  React.useEffect(() => {
    if (!isTransferring || isPaused) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') pauseTransfer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTransferring, isPaused, pauseTransfer]);

  // The confirm opens under the Start button: move focus to it so keyboard users land on the choice.
  React.useEffect(() => {
    if (confirmingMotion) confirmButtonRef.current?.focus();
  }, [confirmingMotion]);

  const beginTransfer = () => {
    photosensitivityNoticeSeen = true;
    setNoticeSeen(true);
    setConfirmingMotion(false);
    startTransfer();
  };
  const handleStart = () => {
    if (reducedMotion) {
      setConfirmingMotion(true);
      return;
    }
    beginTransfer();
  };
  const showNotice = !noticeSeen && selectedFile !== null && !isTransferring;

  // Upper bound before compression: text-like files usually need far fewer frames.
  const selectedSize = React.useMemo(() => selectedFiles.reduce((sum, item) => sum + item.size, 0), [selectedFiles]);
  const selectedLabel = selectedFiles.length > 1 ? `${selectedFiles.length} files` : (selectedFile?.name ?? '');
  const estimate = React.useMemo(() => {
    if (!selectedFile) return null;
    try {
      return estimateTransferFrames(selectedSize, density, outerCode);
    } catch {
      return null;
    }
  }, [selectedFile, selectedSize, density, outerCode]);
  // Fountain streams never end: show frames against the typical number a receiver needs.
  const framesNeeded = fountainInfo ? neededSymbols(fountainInfo.k, fountainInfo.outerCode) : totalFrames;
  const senderPercent = fountainInfo
    ? Math.min(100, Math.round((currentFrameIndex / Math.max(1, framesNeeded)) * 100))
    : progress;
  const hasFile = selectedFile !== null || isTransferring;
  const activeDensityHint = DENSITY_OPTIONS.find(option => option.value === density)?.hint ?? '';
  const activeSpeed = matchTransferSpeed(density, fps);
  // Seconds the stream takes: the exact need once a fountain session exists, an upper bound before.
  const estimatedSeconds = fountainInfo ? (fountainInfo.k * 1.15) / fps : estimate ? estimate.frames / fps : null;

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!settingsLocked) {
      event.dataTransfer.dropEffect = 'copy';
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);

    if (settingsLocked) return;

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    const dropped = Array.from(event.dataTransfer.files ?? []);
    if (dropped.length > 0) {
      setSelectedFiles(dropped);
      stopTransfer();
    }
  };

  return (
    <div className="w-full">
      <ToolWorkspaceLayout
        previewFocusable
        controlsLabel="Transfer settings"
        previewLabel="Transfer QR"
        previewId="transfer-preview"
        header={
          <ToolWorkspaceHeader
            title="Send a File by QR Code"
            subtitle="Stream a file to another device as animated QR codes."
            badge="Beta"
            modeSwitcher={<TransferModeSwitcher currentMode="send" />}
            previewId="transfer-preview"
            previewJumpLabel="Jump to transfer QR"
          />
        }
        controls={
          <>
            {/* File Selection & Pacing Section */}
            <section className="space-y-4">
              <SectionHeading icon={<Upload className="size-4 text-accent" aria-hidden="true" />} eyebrow="1. Choose a File" />
              
              <div className="flex flex-col gap-3">
                <label
                  onDragEnter={handleDragOver}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex min-h-24 w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-3 transition-colors ${
                    settingsLocked
                      ? 'cursor-not-allowed border-line bg-surface-sunken opacity-60'
                      : isDraggingFile
                        ? 'cursor-copy border-accent bg-accent-soft'
                        : 'cursor-pointer border-line bg-surface-sunken hover:bg-surface-hover'
                  }`}
                >
                  <FileUp className="size-6 text-fg-muted" aria-hidden="true" />
                  <span className="max-w-full truncate text-xs font-medium text-fg-muted">
                    {selectedFile ? selectedLabel : 'Choose files or drag & drop'}
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    aria-label="Choose a file to send"
                    multiple
                    onChange={handleFileChange}
                    disabled={settingsLocked}
                  />
                </label>

                {folderSupported && (
                  <>
                    <Button variant="outline" onClick={() => folderInputRef.current?.click()} disabled={settingsLocked} fullWidth>
                      <FolderUp className="size-4" aria-hidden="true" />
                      Send a folder
                    </Button>
                    <input
                      ref={folderInputRef}
                      type="file"
                      className="hidden"
                      aria-label="Choose a folder to send"
                      onChange={handleFileChange}
                      disabled={settingsLocked}
                      {...FOLDER_INPUT_PROPS}
                    />
                  </>
                )}

                {import.meta.env.DEV && (
                  <Button
                    variant="outline"
                    onClick={simulate50MBFile}
                    disabled={settingsLocked}
                    fullWidth
                  >
                    <Cpu className="size-4" />
                    Simulate 50MB High-Load File
                  </Button>
                )}
              </div>

              {selectedFile && (
                <div className="space-y-2 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-fg-muted">{selectedFiles.length > 1 ? 'Files:' : 'Name:'}</span>
                    <span className="max-w-45 truncate font-semibold text-fg-soft">{selectedLabel}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-fg-muted">Size:</span>
                    <span className="font-mono text-fg-soft">{(selectedSize / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                </div>
              )}
            </section>

            <div className="h-px bg-surface-hover" />

            {/* Live Streaming Speed / Pacing controls */}
            <section className="space-y-6">
              <SectionHeading icon={<Sliders className="size-4 text-accent" aria-hidden="true" />} eyebrow="2. Transfer Settings" />

              <div className="space-y-2">
                <span id="speed-label" className="block text-sm font-medium text-fg-soft">
                  Speed
                </span>
                <SegmentedControl<string>
                  labelledBy="speed-label"
                  value={activeSpeed?.id ?? ''}
                  onChange={(id) => {
                    const speed = TRANSFER_SPEEDS.find((candidate) => candidate.id === id);
                    if (!speed) return;
                    setDensity(speed.density);
                    setFps(speed.fps);
                  }}
                  disabled={settingsLocked}
                  options={TRANSFER_SPEEDS.map((speed) => ({ value: speed.id, label: speed.label }))}
                />
                <p className="text-xs text-fg-muted">{activeSpeed?.hint ?? 'Custom values set under Advanced.'}</p>
                <p className="text-sm font-semibold text-fg" data-testid="speed-estimate" aria-live="polite">
                  {estimatedSeconds !== null && selectedFile
                    ? `~${formatShortDuration(estimatedSeconds)} for ${selectedFiles.length > 1 ? `these ${selectedFiles.length} files` : 'this'} ${formatFileSize(selectedSize)}${selectedFiles.length > 1 ? '' : ' file'}`
                    : 'Choose a file to see how long it will take.'}
                </p>
              </div>

              <div className="space-y-1">
                <ToggleSwitch id="private-transfer" label="Private transfer" checked={isPrivate} onChange={setIsPrivate} disabled={settingsLocked} />
                <p className="text-xs text-fg-muted">
                  Encrypts the file and its name. You read a key code to the receiver, who enters it before the file opens. Someone filming the stream cannot read the file without the code.
                </p>
              </div>

              <AccordionItem title="Advanced" headingLevel={3}>
                <div className="space-y-6">
                  <RangeInput
                    id="fps-slider"
                    label="Transfer speed"
                    min={1}
                    max={60}
                    step={1}
                    value={fps}
                    onChange={setFps}
                    formatValue={(v) => `${v} frames/sec`}
                  />

                  <div className="space-y-2">
                    <span id="density-label" className="block text-sm font-medium text-fg-soft">
                      QR density
                    </span>
                    <SegmentedControl<TransferDensity>
                      labelledBy="density-label"
                      value={density}
                      onChange={setDensity}
                      disabled={settingsLocked}
                      options={DENSITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    />
                    <p className="text-xs text-fg-muted">{activeDensityHint}</p>
                  </div>

                  <div className="space-y-1">
                    <ToggleSwitch
                      id="outer-code"
                      label="New transfer format (preview)"
                      checked={outerCode === 'fec'}
                      onChange={(checked) => setOuterCode(checked ? 'fec' : 'lt')}
                      disabled={settingsLocked}
                    />
                    <p className="text-xs text-fg-muted" data-testid="outer-code-hint">
                      {fountainInfo && outerCode === 'fec' && fountainInfo.outerCode === 'lt'
                        ? 'This transfer uses the standard format: it is too large for the new one, or this browser cannot run it.'
                        : 'Copes better with missed frames: the receiver needs only a few frames beyond the file’s size, where the standard format can need 15% more. The receiving device needs the latest QRCraftly.'}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <ToggleSwitch
                      id="multi-code"
                      label="Several codes per frame (preview)"
                      checked={multiCode}
                      onChange={setMultiCode}
                      disabled={settingsLocked}
                    />
                    <p className="text-xs text-fg-muted" data-testid="multi-code-hint">
                      {fountainInfo && multiCode && !fountainInfo.tiles
                        ? 'This screen is too small for several codes, so this transfer shows one at a time.'
                        : 'Shows up to four large codes at once, timed to the display, with one bigger code every few frames for cameras that cannot read them. Turn on “Read several codes per frame” on the receiving device.'}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <ToggleSwitch
                      id="steer-speed"
                      label="Let the receiver steer (preview)"
                      checked={steer && multiCode}
                      onChange={setSteer}
                      disabled={settingsLocked || !multiCode}
                    />
                    <p className="text-xs text-fg-muted" data-testid="steer-hint">
                      {multiCode
                        ? 'Uses this device’s camera to read a small code on the receiving screen, so the transfer speeds up or slows down for it and stops once it has the file. The camera is asked for when you start, and nothing it sees leaves this device. Turn on “Help the sender pick its speed” on the receiving device.'
                        : 'Needs “Several codes per frame”.'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <ToggleSwitch
                      id="wallet-bcur"
                      label="Wallet-compatible (BC-UR)"
                      checked={walletCompat && !isPrivate}
                      onChange={setWalletCompat}
                      disabled={settingsLocked || isPrivate}
                    />
                    <p className="text-xs text-fg-muted" data-testid="wallet-bcur-hint">
                      {isPrivate
                        ? 'Not available for a private transfer: BC-UR has no encryption.'
                        : 'Sends the file as a standard BC-UR animated QR (ur:bytes) that hardware wallets and other BC-UR apps can read, as well as QRCraftly. It is slower, carries only the file’s bytes, not its name, and sends one file at a time. The other options above do not apply to it.'}
                    </p>
                  </div>
                  <p className="text-xs text-fg-muted" data-testid="fountain-symbol-info">
                    {walletCompat && !isPrivate
                      ? 'A wallet-compatible stream carries fewer bytes per QR than QRCraftly’s own format, so it takes longer. It repeats until you stop it.'
                      : fountainInfo?.tiles
                      ? `Each code carries ${fountainInfo.symbolSize}-byte pieces (${fountainInfo.compression === 'deflate-raw' ? 'compressed' : 'uncompressed'}). How fast it goes depends on the receiving camera.`
                      : fountainInfo
                      ? `Each QR carries ${fountainInfo.symbolSize} bytes (${fountainInfo.compression === 'deflate-raw' ? 'compressed' : 'uncompressed'}). The receiver needs about ${framesNeeded} frames, ${formatDuration(framesNeeded / fps)} at ${fps} frames/sec.`
                      : estimate
                        ? `Estimated transfer time: up to ${formatDuration(estimate.frames / fps)} at ${fps} frames/sec (${estimate.symbolSize} bytes per QR). Text and other compressible files go faster.`
                        : 'Choose a file to see how long the transfer will take.'}
                  </p>
                </div>
              </AccordionItem>
            </section>

            {/* Beta notice after the primary actions so they stay in the first mobile viewport. */}
            <BetaNotice />
          </>
        }
        preview={
            <Card>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-fg-soft">
                  Transfer QR
                </h2>
                {hasFile && (
                  <Badge tone={isTransferring && !isPaused ? 'success' : 'neutral'}>
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${isTransferring && !isPaused ? 'bg-success motion-safe:animate-pulse' : 'bg-line-strong'}`} />
                    {isPaused ? 'Paused' : isTransferring ? 'Transmitting' : 'Ready'}
                  </Badge>
                )}
              </div>

              {!hasFile && (
                <div
                  onDragEnter={handleDragOver}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  data-testid="send-empty-state"
                >
                  <EmptyState
                    level={3}
                    className={`aspect-square transition-colors ${isDraggingFile ? 'border-accent bg-accent-soft' : ''}`}
                    illustration={<QrIllustration className={`size-7 text-accent ${isDraggingFile ? 'motion-safe:animate-pulse' : ''}`} />}
                    title="Drop a file to beam it"
                    body="It plays as animated QR codes for the other device's camera. Nothing is uploaded."
                    action={
                      <Button variant="primary" onClick={() => fileInputRef.current?.click()}>
                        <FileUp className="size-4" aria-hidden="true" />
                        Choose a file
                      </Button>
                    }
                  />
                </div>
              )}

              {/* Start / Pause / Stop come before the stream so they follow the settings directly on mobile. */}
              <div className={`mb-4 flex gap-3 ${hasFile ? '' : 'hidden'}`}>
                {!isTransferring ? (
                  <Button
                    variant="primary"
                    fullWidth
                    onClick={handleStart}
                    disabled={isVerifyingHandshake}
                    aria-label="Start file transfer"
                    aria-describedby={showNotice ? 'photosensitivity-notice' : undefined}
                  >
                    <Play className="size-4" aria-hidden="true" />
                    {isVerifyingHandshake ? 'Checking QR…' : 'Start Transfer'}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={isPaused ? resumeTransfer : pauseTransfer}
                      aria-keyshortcuts={isPaused ? undefined : 'Escape'}
                    >
                      {isPaused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
                      {isPaused ? 'Resume' : 'Pause'}
                    </Button>
                    <Button variant="error" fullWidth onClick={stopTransfer} aria-label="Stop file transfer">
                      <Square className="size-4" aria-hidden="true" />
                      Stop Transfer
                    </Button>
                  </>
                )}
              </div>

              {/* A live region that is always present, so the notice is announced when it appears. */}
              <div role="status" aria-live="polite">
                {showNotice && (
                  <p
                    id="photosensitivity-notice"
                    className="mb-4 rounded-xl border border-warning-line bg-warning-soft p-3 text-sm text-warning"
                    data-testid="photosensitivity-notice"
                  >
                    {PHOTOSENSITIVITY_NOTICE}
                  </p>
                )}
                {isPaused && <p className="sr-only">{PAUSED_ANNOUNCEMENT}</p>}
              </div>

              {confirmingMotion && !isTransferring && (
                <div
                  role="group"
                  aria-labelledby="motion-confirm-title"
                  className="mb-4 rounded-xl border border-warning-line bg-warning-soft p-3 text-sm text-warning"
                  data-testid="reduced-motion-confirm"
                >
                  <p id="motion-confirm-title" className="font-semibold">
                    {REDUCED_MOTION_CONFIRM_TITLE}
                  </p>
                  <p className="mt-1">{REDUCED_MOTION_CONFIRM_BODY}</p>
                  <div className="mt-3 flex gap-3">
                    <Button ref={confirmButtonRef} variant="primary" size="sm" onClick={beginTransfer}>
                      Start anyway
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setConfirmingMotion(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {isTransferring && (
                <p className="mb-4 text-xs text-fg-muted" data-testid="pause-hint">
                  {PAUSE_HINT}
                </p>
              )}

              {selectedFile && !isTransferring && !handshakeError && <PairingGuide />}

              {autoStopped && !isTransferring && (
                <div className="mb-4">
                  <Alert variant="info" title="Transfer stopped" role="status">
                    Every receiver in view has the file, so the sender stopped.
                  </Alert>
                </div>
              )}

              {/* Handshake scannability failure alert */}
              {handshakeError && (
                <div className="mb-4">
                  <Alert variant="error" title="Transfer Paused" role="alert">
                    {handshakeError}
                  </Alert>
                </div>
              )}

              {/* Active Transfer Stats */}
              {isTransferring && (
                <div className="mb-4 space-y-3 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs" data-testid="sender-progress">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1 font-medium text-fg-muted">
                      <Activity className="size-3.5 text-accent" aria-hidden="true" /> {fountainInfo ? 'First pass:' : 'Progress:'}
                    </span>
                    <span className="font-mono font-bold text-fg">{senderPercent}%</span>
                  </div>
                  
                  <Progress size="sm" label="Transfer progress" value={senderPercent} />

                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div>
                      <div className="text-fg-muted">{fountainInfo ? 'Frames shown' : `Current QR (Pass ${currentPass})`}</div>
                      <div className="font-mono text-sm font-semibold text-fg-soft" data-testid="sender-frames">
                        {fountainInfo ? `${currentFrameIndex} of ~${framesNeeded}` : `${currentFrameIndex} / ${totalFrames}`}
                        {!fountainInfo && (
                          <span className="ml-1 text-xs text-accent">
                            {currentPass === 1 ? '(Seq)' : '(Shuffled)'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-fg-muted">
                        <Cpu className="size-3 text-accent" aria-hidden="true" /> Frame buffer
                      </div>
                      <div className="font-mono text-sm font-semibold text-fg-soft">{transferStats.frameBufferMemory}</div>
                    </div>
                  </div>
                  {fountainInfo?.keyCode && (
                    <div className="space-y-2 rounded-lg border border-line bg-surface p-3" data-testid="sender-key-panel">
                      <p className="font-semibold text-fg">Key code</p>
                      <p className="font-mono text-sm font-semibold break-words text-fg-soft" aria-live="polite">
                        {showingKeyCode ? (
                          <span data-testid="sender-key-code">{fountainInfo.keyCode}</span>
                        ) : (
                          <span className="font-sans font-normal text-fg-muted" data-testid="sender-key-code-hidden">
                            Hidden while the stream plays.
                          </span>
                        )}
                      </p>
                      <p className="text-fg-muted">
                        Hold a button to show the eight words to read to the receiver, or a QR code they can scan. Anyone filming this screen while the key shows can read the file, so show it only out of view of other cameras.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" {...holdToShow(() => setShowingKeyCode(true), () => setShowingKeyCode(false))}>
                          Hold to show key code
                        </Button>
                        <Button variant="outline" {...holdToShow(showKeyQr, hideKeyQr)}>
                          Hold to show key QR
                        </Button>
                      </div>
                      <canvas
                        ref={keyCanvasRef}
                        className={`mx-auto aspect-square w-48 rounded-lg bg-surface ${keyFrame ? '' : 'hidden'}`}
                        role="img"
                        aria-label="Key code QR"
                        width={512}
                        height={512}
                      />
                    </div>
                  )}
                  {fountainInfo && (
                    <p className="text-fg-muted" data-testid="sender-fingerprint">
                      Transfer code <span className="font-mono font-semibold text-fg-soft">{fountainInfo.fingerprint}</span>. The receiver shows the same four words once it has read the transfer details. If they differ, it is reading another device.
                    </p>
                  )}
                  {steerState.status !== 'off' && (
                    <p className="text-fg-muted" role="status" data-testid="steer-status">
                      {steerMessage(steerState, steeredProfile, steeringReceivers)}
                    </p>
                  )}
                  {fountainInfo && (
                    <p className="text-fg-muted">
                      The stream keeps going after the first pass so a receiver can join late or miss frames. Stop once the receiver shows Transfer Complete.
                    </p>
                  )}
                </div>
              )}

              {/* Recycled UI Canvas Container */}
              <div className={`mb-4 flex items-center justify-center rounded-2xl border border-line-subtle bg-surface-sunken p-4 sm:p-6 ${hasFile ? '' : 'hidden'}`}>
                <div className="relative w-full overflow-hidden rounded-lg">
                  <canvas
                    ref={canvasRef}
                    className={`aspect-square w-full rounded-lg bg-surface object-contain shadow-sm ${tileInfo ? 'max-h-[85vh]' : 'max-h-[60vh]'}`}
                    role="img"
                    aria-label="Transfer QR code"
                    width={512}
                    height={512}
                  />
                  {/* A soft band sweeps the sending QR while it plays (motion-safe only). */}
                  {isTransferring && !isPaused && (
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
                      <div className="h-1/3 w-full bg-linear-to-b from-transparent via-accent/20 to-transparent motion-safe:animate-scan-sweep" />
                    </div>
                  )}
                </div>
              </div>

              {hasFile && (
                <p className="text-xs text-fg-muted">
                  Transfer codes are always plain black on white, so every frame scans.
                </p>
              )}
            </Card>
        }
      />
    </div>
  );
}

/**
 * High-Performance Animated QR File Transfer Page Component
 * @returns The rendered Page component.
 */
export default function Page() {
  return <FileTransferToolInner />;
}
