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

import { useCallback } from 'react';
import { Activity, Camera } from 'lucide-react';
import { describeCameraError } from '@/packages/optical-transfer';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Card } from '@/components/ui/Card';
import { BetaNotice } from '@/components/BetaNotice';
import { ToolWorkspaceLayout, ToolWorkspaceHeader } from '@/components/ToolWorkspaceLayout';
import { TransferModeSwitcher } from '@/components/TransferModeSwitcher';
import { useToast } from '@/components/ui/Toast';
import { useOpticalReceiver } from '@/packages/optical-transfer/client';
import { triggerFileDownload } from '@/utils/downloadManager';
import { QRProvider } from '@/context/QRContext';
import { KeyCodeEntry } from '@/components/transfer/KeyCodeEntry';
import { TransferStatusBadge } from '@/components/transfer/TransferStatusBadge';
import { CameraPanel } from '@/components/transfer/receive/CameraPanel';
import { ReceiveError } from '@/components/transfer/receive/ReceiveError';
import { ReceiveModeSwitch } from '@/components/transfer/receive/ReceiveModeSwitch';
import { ReceiveOptions } from '@/components/transfer/receive/ReceiveOptions';
import { ReceiveSimulator } from '@/components/transfer/receive/ReceiveSimulator';
import { ReceiveTelemetry } from '@/components/transfer/receive/ReceiveTelemetry';
import { ReceiveViewport } from '@/components/transfer/receive/ReceiveViewport';
import { SwitchOffer } from '@/components/transfer/receive/SwitchOffer';
import { VideoPanel } from '@/components/transfer/receive/VideoPanel';
import { useFileDrop } from '@/hooks/useFileDrop';
import { completionView } from './completionView';
import { useAnnounced, useArrivalChime, useSaveBundleZip } from './receiveHooks';

/** The page's title, the send and receive switch, and the jump to the camera. */
const RECEIVE_HEADER = (
  <ToolWorkspaceHeader
    title="Receive a File by QR Code"
    subtitle="Scan an animated transfer QR with your camera or a video."
    badge="Beta"
    modeSwitcher={<TransferModeSwitcher currentMode="receive" />}
    previewId="receiver-viewport"
    previewJumpLabel="Jump to camera"
  />
);

function FileTransferReceiveInner() {
  const { addToast } = useToast();
  const receiver = useOpticalReceiver({
    saveFile: triggerFileDownload,
    addToast,
    autoDownload: false,
  });
  const { manifest, receiverError, isScanning, cameraError, bcur, handleClear, startCameraSession, fountainStats, phase, result, receiverMode, setReceiverMode, videoFile, fileValidationError, bundle, saveReceivedFile } = receiver;

  // A wallet-style stream has its own completion view, picked by `bcur` below.
  const isComplete = phase === 'complete' && result?.kind !== 'bcur';
  // Clearing only makes sense once something has been received or loaded.
  const hasProgress = fountainStats !== null || manifest !== null || videoFile !== null || isComplete;
  const announced = useAnnounced(manifest);
  const saveBundleZip = useSaveBundleZip(bundle, addToast);

  // Drag and drop, or a click, Enter or Space to browse, for the video file upload.
  const drop = useFileDrop({
    onFiles: ([file]) => receiver.handleFileUpload(file),
    accept: 'video/*',
  });

  const [soundOn, setSoundOn] = useArrivalChime(isComplete || bcur !== null);

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

  const completion = completionView(phase, result, bcur, {
    saved: receiver.downloadTriggered,
    onSaveFile: handleManualDownload,
    onSaveAll: () => void saveBundleZip(),
    onReceiveAnother: receiveAnother,
  });

  return (
    <div className="w-full">
      <ToolWorkspaceLayout
        previewFocusable
        controlsLabel="Receiver Settings and Controls"
        previewLabel="Camera Capture Viewport"
        previewId="receiver-viewport"
        header={RECEIVE_HEADER}
        controls={
          <>
            {/* Connection / Status Section */}
            <section className="space-y-4">
              <SectionHeading icon={<Camera className="size-4 text-accent" aria-hidden="true" />} eyebrow="1. Scan Transfer QR" />

              {/* Dual-Mode Pill Switcher */}
              <ReceiveModeSwitch mode={receiverMode} onChange={setReceiverMode} />

              <div className="flex flex-col gap-3">
                {receiver.needsKey && <KeyCodeEntry onSubmit={receiver.submitKeyCode} accepted={receiver.keyAccepted} />}
                {receiver.switchOffer && <SwitchOffer offer={receiver.switchOffer} onAnswer={receiver.answerSwitch} />}
                {receiverError && <ReceiveError failure={{ source: 'receiver', message: receiverError }} />}
                {fileValidationError && <ReceiveError failure={{ source: 'file', message: fileValidationError }} />}
                {receiverMode === 'camera' && cameraError && !isScanning && (
                  <ReceiveError failure={{ source: 'camera', message: describeCameraError(cameraError) }} onUseVideo={() => setReceiverMode('file')} />
                )}

                {receiverMode === 'camera' ? (
                  <CameraPanel scanning={isScanning} canClear={hasProgress} onStart={startCameraSession} onStop={receiver.stopCameraSession} onClear={handleClear} />
                ) : (
                  <VideoPanel videoFile={videoFile} drop={drop} canClear={hasProgress} onClear={handleClear} />
                )}

              </div>
            </section>

            <ReceiveOptions
              soundOn={soundOn}
              onSoundChange={setSoundOn}
              multiCode={receiver.multiCode}
              onMultiCodeChange={receiver.setMultiCode}
              camera={receiver.camera}
              layerHint={receiver.layerHint}
              steerSender={receiver.steerSender}
              onSteerSenderChange={receiver.setSteerSender}
              feedbackActive={receiver.feedbackActive}
              feedbackCanvasRef={receiver.feedbackCanvasRef}
            />

            {/* Beta notice after the primary actions so they stay in the first mobile viewport. */}
            <BetaNotice />
          </>
        }
        secondary={
          <>
            {/* Live Progress Metrics */}
            <section className="space-y-4">
              <SectionHeading icon={<Activity className="size-4 text-accent" aria-hidden="true" />} eyebrow="2. Transfer Progress" />
              <ReceiveTelemetry
                compilationStatus={receiver.compilationStatus}
                bcurProgress={receiver.bcurProgress}
                bcurDone={bcur !== null}
                announced={announced}
                complete={isComplete}
                fountainStats={fountainStats}
              />
            </section>

            <ReceiveSimulator onClear={handleClear} onFrame={receiver.handleFrame} />

          </>
        }
        preview={
            <Card className="overflow-hidden">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="font-semibold text-fg-soft">
                  {receiverMode === 'camera' ? 'Camera Viewport' : 'Video Viewport'}
                </h2>
                <div className="flex items-center gap-2">
                  <TransferStatusBadge active={isScanning} label={isScanning ? 'Active Scanning' : 'Idle'} />
                </div>
              </div>

              {/* Video frame box with targeting guide or dropzone */}
              <ReceiveViewport
                receiverMode={receiverMode}
                scanning={isScanning}
                complete={isComplete}
                completion={completion}
                videoFile={videoFile}
                videoRef={receiver.videoRef}
                lockOn={receiver.lockOn}
                drop={drop}
                onStartCamera={startCameraSession}
              />

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
