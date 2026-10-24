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

import React, { useState, useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { createPrismSession, describeCameraError, formatDuration, TRANSFER_DENSITY_PROFILES } from '@/packages/optical-transfer';
import { Play, Square, Camera, Activity, Cpu, Trash2, Upload, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Tooltip } from '@/components/ui/Tooltip';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Alert';
import { BetaNotice } from '@/components/BetaNotice';
import { ToolWorkspaceLayout, ToolWorkspaceHeader } from '@/components/ToolWorkspaceLayout';
import { TransferModeSwitcher } from '@/components/TransferModeSwitcher';
import { useToast } from '@/components/ui/Toast';
import { useOpticalReceiver } from '@/packages/optical-transfer/client';
import { triggerFileDownload } from '@/utils/downloadManager';
import { QRProvider } from '@/context/QRContext';
import { ChunkConstellation } from '@/components/transfer/ChunkConstellation';
import { TransferComplete } from '@/components/transfer/TransferComplete';
import { BcUrComplete } from '@/components/transfer/BcUrComplete';
import { BundleComplete } from '@/components/transfer/BundleComplete';
import { KeyCodeEntry } from '@/components/transfer/KeyCodeEntry';
import { LockOnBrackets } from '@/components/transfer/LockOnBrackets';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { playChime, unlockChime, vibrate } from '@/utils/feedback';
import { analyseReceivedFile } from '@/packages/core/files';
import { formatFileSize } from '@/utils/transferSpeed';
import { useFileDrop } from '@/hooks/useFileDrop';

function FileTransferReceiveInner() {
  const { addToast } = useToast();

  const viewportRef = useRef<HTMLDivElement | null>(null);

  // Use the unified animated QR receiver hook
  const {
    manifest,
    receiverError,
    isScanning,
    cameraError,
    camera,
    multiCode,
    setMultiCode,
    layerHint,
    steerSender,
    setSteerSender,
    feedbackActive,
    feedbackCanvasRef,
    lockOn,
    bcur,
    bcurProgress,
    videoRef,
    handleClear,
    handleFrame,
    startCameraSession,
    stopCameraSession,
    downloadTriggered,
    saveReceivedFile,
    handshake,
    compilationStatus,
    fountainStats,
    phase,
    result,
    receiverMode,
    setReceiverMode,
    videoFile,
    fileValidationError,
    handleFileUpload,
    reassembledData,
    needsKey,
    keyAccepted,
    submitKeyCode,
    switchOffer,
    answerSwitch,
    bundle,
  } = useOpticalReceiver({
    saveFile: triggerFileDownload,
    addToast,
    autoDownload: false,
  });

  // A wallet-style stream has its own completion view, picked by `bcur` below.
  const isComplete = phase === 'complete' && result?.kind !== 'bcur';
  // Clearing only makes sense once something has been received or loaded.
  const hasProgress = fountainStats !== null || manifest !== null || videoFile !== null || isComplete;
  // The name comes from whoever is showing the stream: show the sanitised form.
  const announced = useMemo(() => {
    if (!manifest) return null;
    // A private or multi-file transfer lists no single file up front.
    const file = manifest.files[0] ?? null;
    return { ...manifest, file, safeName: file ? analyseReceivedFile(file.name, file.mimeType).safeName : null };
  }, [manifest]);

  /** Saves every received file in one ZIP. The archive code loads only when it is needed. */
  const saveBundleZip = useCallback(async () => {
    if (!bundle) return;
    try {
      const { createZip } = await import('@/packages/bulk-csv');
      const zip = createZip(bundle.map((file) => ({ name: file.name, data: file.data })));
      triggerFileDownload(zip, 'qrcraftly-files.zip', 'application/zip');
    } catch (error) {
      addToast({ type: 'error', message: error instanceof Error ? error.message : 'The archive could not be made.', duration: 5000 });
    }
  }, [bundle, addToast]);

  // Drag and drop, or a click, Enter or Space to browse, for the video file upload.
  const { isDragging, inputRef: fileInputRef, dropProps, inputProps, browseProps } = useFileDrop({
    onFiles: ([file]) => handleFileUpload(file),
    accept: 'video/*',
  });

  // A short buzz when the file arrives, and a chime only if the person turned sound on.
  const [soundOn, setSoundOn] = useState(false);
  // Reads the sound switch as it is when a transfer finishes. Flipping the switch afterwards must not replay it.
  const announceArrival = useEffectEvent(() => {
    vibrate([30, 50, 30]);
    if (soundOn) playChime();
  });
  useEffect(() => {
    if (!isComplete && !bcur) return;
    announceArrival();
  }, [isComplete, bcur]);

  /** Clears the finished transfer and, in camera mode, starts scanning for the next one. */
  const receiveAnother = useCallback(() => {
    handleClear();
    if (receiverMode === 'camera') void startCameraSession();
  }, [handleClear, receiverMode, startCameraSession]);

  // The file is saved on the person's click, after one more integrity check.
  const handleManualDownload = useCallback(() => {
    if (!isComplete) return;
    void saveReceivedFile();
  }, [isComplete, saveReceivedFile]);

  // Simulation controls
  // Rateless Prism stream joined mid-stream with ~30% of frames dropped.
  const simulatePrismStream = async () => {
    handleClear();
    const text = 'Prism-coded air-gapped transfer: join at any frame, lose any frame. '.repeat(8);
    const { stream } = await createPrismSession(new TextEncoder().encode(text), {
      fileName: 'prism_demo.txt',
      mimeType: 'text/plain',
      errorCorrectionLevel: TRANSFER_DENSITY_PROFILES.balanced.errorCorrectionLevel,
      maxVersion: TRANSFER_DENSITY_PROFILES.balanced.maxVersion,
    });
    let delay = 0;
    for (let index = 7; index < stream.k * 4 + 32; index++) {
      if (index % 10 < 3) continue;
      const frame = stream.frameText(index);
      setTimeout(() => handleFrame(frame), delay);
      delay += 20;
    }
  };

  return (
    <div className="w-full">
      <ToolWorkspaceLayout
        previewFocusable
        controlsLabel="Receiver Settings and Controls"
        previewLabel="Camera Capture Viewport"
        previewId="receiver-viewport"
        header={
          <ToolWorkspaceHeader
            title="Receive a File by QR Code"
            subtitle="Scan an animated transfer QR with your camera or a video."
            badge="Beta"
            modeSwitcher={<TransferModeSwitcher currentMode="receive" />}
            previewId="receiver-viewport"
            previewJumpLabel="Jump to camera"
          />
        }
        controls={
          <>
            {/* Connection / Status Section */}
            <section className="space-y-4">
              <SectionHeading icon={<Camera className="size-4 text-accent" aria-hidden="true" />} eyebrow="1. Scan Transfer QR" />

              {/* Dual-Mode Pill Switcher */}
              <SegmentedControl<'camera' | 'file'>
                label="Receiver Input Mode"
                value={receiverMode}
                onChange={setReceiverMode}
                options={[
                  {
                    value: 'camera',
                    label: (
                      <>
                        <Camera className="size-4" aria-hidden="true" />
                        Camera Feed
                      </>
                    ),
                  },
                  {
                    value: 'file',
                    label: (
                      <>
                        <Upload className="size-4" aria-hidden="true" />
                        Video File
                      </>
                    ),
                  },
                ]}
              />

              <div className="flex flex-col gap-3">
                {needsKey && <KeyCodeEntry onSubmit={submitKeyCode} accepted={keyAccepted} />}

                {switchOffer && (
                  <div data-testid="switch-offer" role="alert">
                    <Alert variant="warning" title="Another transfer is in view">
                      <p>
                        {switchOffer.encrypted
                          ? 'A private transfer'
                          : switchOffer.bundle
                            ? `${switchOffer.entryCount > 0 ? `${switchOffer.entryCount} files` : 'Several files'}`
                            : switchOffer.files[0]
                              ? analyseReceivedFile(switchOffer.files[0].name, switchOffer.files[0].mimeType).safeName
                              : 'Another file'}{' '}
                        ({switchOffer.fingerprint}) is also on screen. Switching drops what you have received so far.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="primary" size="sm" onClick={() => answerSwitch(true)}>
                          Switch to it
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => answerSwitch(false)}>
                          Keep this one
                        </Button>
                      </div>
                    </Alert>
                  </div>
                )}

                {receiverError && (
                  <div data-testid="receiver-error">
                    <Alert variant="error" title="Transfer Error">
                      {receiverError}
                    </Alert>
                  </div>
                )}

                {fileValidationError && (
                  <div data-testid="file-validation-error">
                    <Alert variant="error" title="Invalid File">
                      {fileValidationError}
                    </Alert>
                  </div>
                )}

                {receiverMode === 'camera' && cameraError && !isScanning && (
                  <div data-testid="camera-error">
                    <Alert variant="error" title="Camera unavailable">
                      <p>{describeCameraError(cameraError)}</p>
                      <p className="mt-2">
                        No camera? Record the sender&apos;s screen with another device and open the recording under Video File.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        onClick={() => setReceiverMode('file')}
                      >
                        <Upload className="size-4" aria-hidden="true" />
                        Use a video file instead
                      </Button>
                    </Alert>
                  </div>
                )}

                {receiverMode === 'camera' ? (
                  <div className="flex gap-3">
                    {!isScanning ? (
                      <Button
                        variant="primary"
                        fullWidth
                        onClick={startCameraSession}
                        aria-label="Activate camera scanner"
                      >
                        <Play className="size-4" />
                        Activate Camera Scanner
                      </Button>
                    ) : (
                      <Button
                        variant="error"
                        fullWidth
                        onClick={stopCameraSession}
                        aria-label="Deactivate camera scanner"
                      >
                        <Square className="size-4" />
                        Deactivate Scanner
                      </Button>
                    )}
                    {hasProgress && (
                      <Tooltip content="Clear transfer progress">
                        <Button variant="outline" iconOnly onClick={handleClear} aria-label="Clear transfer progress">
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div
                      {...browseProps}
                      {...dropProps}
                      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
                        isDragging
                          ? 'border-accent bg-accent-soft'
                          : 'border-line hover:border-accent'
                      }`}
                      data-testid="sidebar-dropzone"
                    >
                      <Upload className="mb-2 size-6 text-accent" />
                      <p className="text-xs font-semibold text-fg-soft">
                        {videoFile ? videoFile.name : 'Drop video file here or click to browse'}
                      </p>
                      <p className="mt-1 text-xs text-fg-muted">
                        {videoFile ? formatFileSize(videoFile.size) : 'MP4, WebM, MOV, etc.'}
                      </p>
                      <input
                        {...inputProps}
                        ref={fileInputRef}
                        className="hidden"
                        data-testid="video-file-input"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        fullWidth
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="Select Video File"
                      >
                        <Upload className="size-4" />
                        {videoFile ? 'Replace Video' : 'Select Video File'}
                      </Button>
                      {hasProgress && (
                        <Tooltip content="Clear transfer progress">
                          <Button variant="outline" iconOnly onClick={handleClear} aria-label="Clear transfer progress">
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </section>

            <ToggleSwitch id="receive-sound" label="Play a chime when the file arrives" checked={soundOn}
              onChange={(on) => {
                // The switch is the gesture iOS needs before the chime can play later.
                if (on) unlockChime();
                setSoundOn(on);
              }}
            />

            <div className="space-y-1">
              <ToggleSwitch id="receive-multi-code" label="Read several codes per frame (preview)" checked={multiCode} onChange={setMultiCode} />
              <p className="text-xs text-fg-muted" data-testid="receive-multi-code-hint">
                {multiCode && camera && camera.width > 0
                  ? `The camera streams ${camera.width}×${camera.height}${camera.frameRate > 0 ? ` at ${Math.round(camera.frameRate)} frames/sec` : ''}.`
                  : 'For a sender showing several codes at once. Asks the camera for 60 frames a second.'}
              </p>
              {multiCode && (
                <p role="status" className="text-sm font-medium text-fg" data-testid="layer-hint">
                  {layerHint ?? ''}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <ToggleSwitch
                id="receive-steer"
                label="Help the sender pick its speed (preview)"
                checked={steerSender && multiCode}
                onChange={setSteerSender}
                disabled={!multiCode}
              />
              <p className="text-xs text-fg-muted" data-testid="receive-steer-hint">
                {multiCode
                  ? 'Shows a small code in the corner of this screen with how well this device reads, so a sender with “Let the receiver steer” on can change speed and stop once you have the file. Keep that corner in view of the sender’s camera.'
                  : 'Needs “Read several codes per frame”.'}
              </p>
            </div>

            {/* The feedback code sits in a corner, where the sender's webcam can see it. */}
            {feedbackActive && (
              <canvas
                ref={feedbackCanvasRef}
                className="fixed right-4 bottom-4 z-50 size-32 rounded-lg bg-surface shadow-overlay"
                role="img"
                aria-label="Feedback code for the sender"
                data-testid="feedback-code"
                width={256}
                height={256}
              />
            )}

            {/* Beta notice after the primary actions so they stay in the first mobile viewport. */}
            <BetaNotice />
          </>
        }
        secondary={
          <>
            {/* Live Progress Metrics */}
            <section className="space-y-4">
              <SectionHeading icon={<Activity className="size-4 text-accent" aria-hidden="true" />} eyebrow="2. Transfer Progress" />

              {compilationStatus && (
                <div className="flex items-center gap-2 rounded-xl border border-accent-line bg-accent-soft p-4 text-xs text-accent motion-safe:animate-pulse" data-testid="compilation-status">
                  <Cpu className="size-4 text-accent motion-safe:animate-spin" />
                  <span className="font-semibold">{compilationStatus}</span>
                </div>
              )}

              {bcurProgress && !bcur && (
                <p className="rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs text-fg-muted" role="status" data-testid="bcur-progress">
                  Reading a wallet-style (BC-UR) stream: {bcurProgress.received} of {bcurProgress.total} parts seen.
                </p>
              )}

              {announced && !isComplete && (
                <div className="space-y-2 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs" data-testid="manifest-info">
                  <p className="text-fg-muted">The sender is sending</p>
                  <p className="text-sm font-semibold break-all text-fg" data-testid="manifest-name">
                    {announced.encrypted
                      ? 'A private transfer'
                      : announced.safeName ?? (announced.entryCount > 0 ? `${announced.entryCount} files` : 'Several files')}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-fg-muted">
                    <dt>Size</dt>
                    <dd className="font-mono text-fg-soft" data-testid="manifest-size">{announced.encrypted ? 'hidden' : formatFileSize(announced.totalSize)}</dd>
                    <dt>Type</dt>
                    <dd className="font-mono break-all text-fg-soft" data-testid="manifest-type">
                      {announced.encrypted ? 'hidden' : announced.file ? announced.file.mimeType || 'unknown' : 'several files'}
                    </dd>
                    <dt>Transfer code</dt>
                    <dd className="font-mono text-fg-soft" data-testid="manifest-fingerprint">{announced.fingerprint}</dd>
                  </dl>
                  <p className="text-fg-muted">The transfer code matches the one on the sender&apos;s screen. If it does not, you are reading someone else&apos;s stream.</p>
                </div>
              )}

              {fountainStats ? (
                <div className="space-y-4 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs" data-testid="fountain-telemetry">
                  <ChunkConstellation total={fountainStats.k} received={fountainStats.rank} etaSeconds={fountainStats.etaSeconds} formatEta={(seconds) => formatDuration(seconds, 'eta')} label="Blocks decoded" />

                  <dl className="grid grid-cols-2 gap-4 pt-2">
                    <div>
                      <dt className="text-fg-muted">Frames scanned</dt>
                      <dd className="font-mono text-sm font-semibold text-fg-soft" data-testid="fountain-droplets">
                        {fountainStats.dropletsReceived}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Blocks decoded</dt>
                      <dd className="font-mono text-sm font-semibold text-fg-soft" data-testid="fountain-rank">
                        {fountainStats.rank} / {fountainStats.k}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Scan rate</dt>
                      <dd className="font-mono text-sm font-semibold text-fg-soft" data-testid="fountain-fps">
                        {fountainStats.fps.toFixed(1)} fps
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Time left</dt>
                      <dd className="font-mono text-sm font-semibold text-fg-soft" data-testid="fountain-eta">
                        {formatDuration(fountainStats.etaSeconds, 'eta')}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : !announced ? (
                <EmptyState
                  illustration={<ScanLine className="size-6" />}
                  title="Ready to scan"
                  body="Start an animated QR file transfer from the sender."
                />
              ) : null}
            </section>

            {import.meta.env.DEV && (
              <>
                <div className="h-px bg-surface-hover" />

                {/* Quick Testing Simulation Controls */}
                <section className="space-y-4">
                  <SectionHeading icon={<Cpu className="size-4 text-accent" aria-hidden="true" />} eyebrow="3. Simulation & Validation Testing" />

                  <div className="grid grid-cols-1 gap-2">
                    <Button
                      variant="outline"
                      onClick={simulatePrismStream}
                      className="justify-start text-left"
                    >
                      <Activity className="size-4 text-accent" aria-hidden="true" />
                      Simulate Prism Stream (mid-stream, 30% loss)
                    </Button>
                  </div>
                </section>
              </>
            )}

          </>
        }
        preview={
            <Card className="overflow-hidden">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="font-semibold text-fg-soft">
                  {receiverMode === 'camera' ? 'Camera Viewport' : 'Video Viewport'}
                </h2>
                <div className="flex items-center gap-2">
                  <Badge tone={isScanning ? 'success' : 'neutral'}>
                    <span aria-hidden="true" className={`size-1.5 rounded-full ${isScanning ? 'bg-success motion-safe:animate-pulse' : 'bg-line-strong'}`} />
                    {isScanning ? 'Active Scanning' : 'Idle'}
                  </Badge>
                </div>
              </div>

              {/* Video frame box with targeting guide or dropzone */}
              <div ref={viewportRef} className={`relative w-full overflow-hidden rounded-2xl ${receiverMode === 'camera' && !isScanning && !isComplete ? '' : 'border border-line-subtle bg-slate-950'} ${isComplete ? '' : 'aspect-square'}`}>
                {bcur ? (
                  <BcUrComplete type={bcur.type} content={bcur.content} onSave={triggerFileDownload} onReceiveAnother={receiveAnother} />
                ) : isComplete && bundle ? (
                  <BundleComplete
                    files={bundle}
                    onSaveFile={triggerFileDownload}
                    onSaveAll={() => void saveBundleZip()}
                    onReceiveAnother={receiveAnother}
                  />
                ) : isComplete ? (
                  <TransferComplete
                    fileName={handshake?.fileName ?? 'received-file'}
                    fileSize={reassembledData?.length ?? handshake?.fileSize ?? 0}
                    mimeType={handshake?.mimeType ?? ''}
                    sha256={handshake?.sha256}
                    verified={isComplete}
                    data={isComplete ? reassembledData : null}
                    saved={downloadTriggered}
                    onSave={handleManualDownload}
                    onReceiveAnother={receiveAnother}
                  />
                ) : isScanning || (receiverMode === 'file' && videoFile) ? (
                  <>
                    <video
                      ref={videoRef}
                      className="size-full object-cover"
                      playsInline
                      muted
                      loop
                    />
                    <LockOnBrackets containerRef={viewportRef} videoRef={videoRef} active={isScanning} corners={lockOn} />
                  </>
                ) : receiverMode === 'file' ? (
                  <div
                    {...browseProps}
                    {...dropProps}
                    className={`flex size-full cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-6 text-center transition-colors ${
                      isDragging
                        ? 'border-teal-500 bg-teal-950/40 text-teal-300'
                        : 'border-slate-800 text-slate-400 hover:border-teal-500 hover:text-slate-300'
                    }`}
                    data-testid="viewport-dropzone"
                  >
                    <Upload className="size-12 text-teal-500 opacity-50" />
                    <div>
                      <p className="text-sm font-semibold text-slate-200">Drop pre-recorded video here</p>
                      <p className="mt-1 text-xs text-slate-400">or click to browse video files (MP4, WebM)</p>
                    </div>
                  </div>
                ) : (
                  <div className="relative size-full" data-testid="camera-empty-state">
                    <EmptyState
                      className="size-full"
                      illustration={<Camera className="size-6" />}
                      title="Camera is off"
                      body="Start the camera, then point it at the animated QR on the sending screen."
                      action={
                        <Button variant="primary" onClick={startCameraSession}>
                          <Play className="size-4" aria-hidden="true" />
                          Start camera
                        </Button>
                      }
                    />
                    {/* Viewfinder corners. */}
                    <div aria-hidden="true" className="pointer-events-none absolute inset-6">
                      <div className="absolute top-0 left-0 size-8 rounded-tl-lg border-t-4 border-l-4 border-accent" />
                      <div className="absolute top-0 right-0 size-8 rounded-tr-lg border-t-4 border-r-4 border-accent" />
                      <div className="absolute bottom-0 left-0 size-8 rounded-bl-lg border-b-4 border-l-4 border-accent" />
                      <div className="absolute right-0 bottom-0 size-8 rounded-br-lg border-r-4 border-b-4 border-accent" />
                    </div>
                  </div>
                )}

                {/* Target Frame Overlay */}
                {isScanning && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="relative size-64 rounded-3xl border-2 border-dashed border-teal-500/80 bg-transparent shadow-spotlight">
                      <div className="absolute top-0 left-0 size-6 -translate-1 rounded-tl-lg border-t-4 border-l-4 border-teal-400" />
                      <div className="absolute top-0 right-0 size-6 translate-x-1 -translate-y-1 rounded-tr-lg border-t-4 border-r-4 border-teal-400" />
                      <div className="absolute bottom-0 left-0 size-6 -translate-x-1 translate-y-1 rounded-bl-lg border-b-4 border-l-4 border-teal-400" />
                      <div className="absolute right-0 bottom-0 size-6 translate-1 rounded-br-lg border-r-4 border-b-4 border-teal-400" />
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 text-center text-xs leading-relaxed text-fg-muted">
                Position the transfer QR inside the guide. Use good lighting and avoid glare for faster scanning.
              </div>
            </Card>
        }
      />
    </div>
  );
}

/**
 * The main entry point for the Mobile File Transfer Receive Page.
 * Renders the stateful inner component inside the standard QR provider context.
 * @returns The Page component.
 */
export default function Page() {
  return (
    <QRProvider>
      <FileTransferReceiveInner />
    </QRProvider>
  );
}
