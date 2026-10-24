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
import { Upload } from 'lucide-react';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Card } from '@/components/ui/Card';
import { PairingGuide } from '@/components/transfer/PairingGuide';
import { TransferStatusBadge } from '@/components/transfer/TransferStatusBadge';
import { HandshakeErrorAlert } from '@/components/transfer/send/SendAlerts';
import { DevSimulateButton } from '@/components/transfer/send/DevSimulateButton';
import { MotionConfirm } from '@/components/transfer/send/MotionConfirm';
import { SendControls } from '@/components/transfer/send/SendControls';
import { SendDropZone } from '@/components/transfer/send/SendDropZone';
import { SendPreview } from '@/components/transfer/send/SendPreview';
import { SendSettings } from '@/components/transfer/send/SendSettings';
import { SenderKeyPanel } from '@/components/transfer/send/SenderKeyPanel';
import { SendEmptyState } from '@/components/transfer/send/SendEmptyState';
import { SendStatus } from '@/components/transfer/send/SendStatus';
import { phaseSections } from '@/components/transfer/send/phaseNotice';
import { TransferStats } from '@/components/transfer/send/TransferStats';
import { TRANSFER_SPEEDS } from '@/utils/transferSpeed';
import { useFileDrop } from '@/hooks/useFileDrop';
import { BetaNotice } from '@/components/BetaNotice';
import { ToolWorkspaceLayout, ToolWorkspaceHeader } from '@/components/ToolWorkspaceLayout';
import { TransferModeSwitcher } from '@/components/TransferModeSwitcher';
import { useOpticalSender } from '@/packages/optical-transfer/client';
import { SidebarContent } from '@/components/SidebarContent';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { copy } from '@/data/copy/file-transfer';
import { steerMessage } from '@/packages/optical-transfer';
import { paintTransferFrame } from './paintTransferFrame';
import { useSendSummary } from './sendSummary';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

/**
 * Set when the first transfer of this page visit starts, so the photosensitivity notice shows only
 * once per visit. Kept in memory: nothing is stored, and a reload shows the notice again.
 */
let photosensitivityNoticeSeen = false;

/**
 * Opens this device's webcam for the back channel (#1146): the front camera, at a size that reads a
 * small code across a desk. Called only after the person turned steering on and started a transfer.
 * @returns The camera stream.
 */
function openSenderWebcam(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
}

/**
 * High-Performance Animated QR File Transfer Tool - Sender only view
 * @returns The FileTransferToolInner component.
 */
function FileTransferToolInner() {
  const sender = useOpticalSender({ renderFrame: paintTransferFrame, requestWebcam: openSenderWebcam });
  const { selectedFile, selectedFiles, setSelectedFiles, phase, isTransferring, isPaused, settingsLocked, handshakeError, fountainInfo, setDensity, setFps, stopTransfer, startTransfer } = sender;

  // Only some browsers can pick a folder; the button appears once the page knows.
  const [folderSupported, setFolderSupported] = React.useState(false);
  React.useEffect(() => {
    setFolderSupported('webkitdirectory' in document.createElement('input'));
  }, []);

  // Photosensitivity safeguards (#1148).
  const reducedMotion = usePrefersReducedMotion();
  const [noticeSeen, setNoticeSeen] = React.useState(photosensitivityNoticeSeen);

  // Reduced motion starts at the slowest pace.
  React.useEffect(() => {
    if (!reducedMotion) return;
    const slowest = TRANSFER_SPEEDS[0];
    setDensity(slowest.density);
    setFps(slowest.fps);
  }, [reducedMotion, setDensity, setFps]);

  const beginTransfer = () => {
    photosensitivityNoticeSeen = true;
    setNoticeSeen(true);
    startTransfer();
  };
  const handleStart = () => {
    if (reducedMotion) {
      sender.askToStart();
      return;
    }
    beginTransfer();
  };
  const showNotice = !noticeSeen && selectedFile !== null && !isTransferring;

  const { selectedSize, selectedLabel, estimate, framesNeeded, senderPercent, estimatedSeconds } = useSendSummary(sender);
  const hasFile = selectedFile !== null || isTransferring;

  const { isDragging: isDraggingFile, inputRef: fileInputRef, dropProps } = useFileDrop({
    onFiles: (dropped) => {
      setSelectedFiles(dropped);
      stopTransfer();
    },
    multiple: true,
    disabled: settingsLocked,
  });

  const { notice, alert } = phaseSections(phase, <MotionConfirm onConfirm={beginTransfer} onCancel={sender.cancelMotion} />);

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
              <SendDropZone
                dropProps={dropProps}
                isDragging={isDraggingFile}
                inputRef={fileInputRef}
                disabled={settingsLocked}
                selectedLabel={selectedLabel}
                selectedSize={selectedFile ? selectedSize : null}
                several={selectedFiles.length > 1}
                folderSupported={folderSupported}
                onChange={sender.handleFileChange}
              >
                <DevSimulateButton onSimulate={sender.simulate50MBFile} disabled={settingsLocked} />
              </SendDropZone>
            </section>

            <div className="h-px bg-surface-hover" />

            <SendSettings
              {...sender}
              locked={settingsLocked}
              framesNeeded={framesNeeded}
              estimate={estimate}
              estimatedSeconds={estimatedSeconds}
              selection={selectedFile ? { count: selectedFiles.length, size: selectedSize } : null}
            />

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
                {hasFile && <TransferStatusBadge active={isTransferring && !isPaused} label={isPaused ? 'Paused' : isTransferring ? 'Transmitting' : 'Ready'} />}
              </div>

              {!hasFile && <SendEmptyState dropProps={dropProps} isDragging={isDraggingFile} />}

              {/* Start / Pause / Stop come before the stream so they follow the settings directly on mobile. */}
              <SendControls
                running={isTransferring}
                paused={isPaused}
                checking={sender.isVerifyingHandshake}
                hidden={!hasFile}
                describedBy={showNotice ? 'photosensitivity-notice' : undefined}
                onStart={handleStart}
                onPause={sender.pauseTransfer}
                onResume={sender.resumeTransfer}
                onStop={stopTransfer}
              />

              <SendStatus showNotice={showNotice} paused={isPaused} />

              {notice}

              {selectedFile && !isTransferring && !handshakeError && <PairingGuide />}

              {alert}

              {/* Handshake scannability failure alert */}
              {handshakeError && <HandshakeErrorAlert message={handshakeError} />}

              {/* Active Transfer Stats */}
              {isTransferring && (
                <TransferStats
                  percent={senderPercent}
                  fountain={fountainInfo !== null}
                  currentFrameIndex={sender.currentFrameIndex}
                  framesNeeded={framesNeeded}
                  totalFrames={sender.totalFrames}
                  currentPass={sender.currentPass}
                  frameBufferMemory={sender.transferStats.frameBufferMemory}
                  keyPanel={fountainInfo?.keyCode && (
                    <SenderKeyPanel keyCode={fountainInfo.keyCode} showingKeyQr={sender.keyFrame !== null} keyCanvasRef={sender.keyCanvasRef} onShowKeyQr={sender.showKeyQr} onHideKeyQr={sender.hideKeyQr} />
                  )}
                  fingerprint={fountainInfo?.fingerprint ?? null}
                  steerStatus={sender.steerState.status !== 'off' ? steerMessage(sender.steerState, sender.steeredProfile, sender.steeringReceivers) : null}
                />
              )}

              <SendPreview canvasRef={sender.canvasRef} hidden={!hasFile} tiled={sender.tileInfo !== null} playing={isTransferring && !isPaused} />

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
  return (
    <>
      <FileTransferToolInner />
      <div className="mx-auto max-w-3xl px-4 pb-12">
        <PageCopyContext.Provider value={copy}>
          <SidebarContent toolId="file-transfer" />
        </PageCopyContext.Provider>
      </div>
    </>
  );
}
