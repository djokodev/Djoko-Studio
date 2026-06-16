import { useEffect, useRef, useState } from 'react';
import {
  canTransitionRecordingState,
  createInitialRecordingSnapshot,
  transitionRecordingState,
  type RecordingStateSnapshot,
} from './recordingStateMachine';

const recordingTimesliceMs = 1000;

export interface LocalMediaRecorderController {
  snapshot: RecordingStateSnapshot;
  chunkCount: number;
  totalBytes: number;
  selectedMimeType: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  approximateDurationMs: number | null;
  previewAvailable: boolean;
  previewUrl: string | null;
  previewBlobSizeBytes: number;
  previewMimeType: string | null;
  startRecording: (stream: MediaStream | null, preferredMimeType?: string | null) => boolean;
  stopRecording: () => boolean;
  resetRecording: () => boolean;
}

interface RecordingSessionMetadata {
  chunkCount: number;
  totalBytes: number;
  selectedMimeType: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
}

interface RecordingPlaybackPreviewMetadata {
  previewAvailable: boolean;
  previewUrl: string | null;
  previewBlobSizeBytes: number;
  previewMimeType: string | null;
}

const initialRecordingSessionMetadata: RecordingSessionMetadata = {
  chunkCount: 0,
  totalBytes: 0,
  selectedMimeType: null,
  startedAt: null,
  stoppedAt: null,
};

const initialRecordingPlaybackPreviewMetadata: RecordingPlaybackPreviewMetadata = {
  previewAvailable: false,
  previewUrl: null,
  previewBlobSizeBytes: 0,
  previewMimeType: null,
};

export function useLocalMediaRecorder(): LocalMediaRecorderController {
  const [snapshot, setSnapshot] = useState<RecordingStateSnapshot>(createInitialRecordingSnapshot());
  const [metadata, setMetadata] = useState<RecordingSessionMetadata>(
    initialRecordingSessionMetadata,
  );
  const [preview, setPreview] = useState<RecordingPlaybackPreviewMetadata>(
    initialRecordingPlaybackPreviewMetadata,
  );
  const snapshotRef = useRef(snapshot);
  const metadataRef = useRef(metadata);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const isMountedRef = useRef(true);
  const [, setDurationTick] = useState(0);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    metadataRef.current = metadata;
  }, [metadata]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      disposePreviewObjectUrl();
      stopAndDisposeRecorder();
      clearRecordingChunks();
    };
  }, []);

  useEffect(() => {
    if (snapshot.state !== 'recording' && snapshot.state !== 'stopping') {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setDurationTick((current) => current + 1);
    }, recordingTimesliceMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [snapshot.state]);

  const approximateDurationMs = getApproximateDurationMs(snapshot, metadata);

  function commitSnapshot(nextSnapshot: RecordingStateSnapshot) {
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
  }

  function commitMetadata(nextMetadata: RecordingSessionMetadata) {
    metadataRef.current = nextMetadata;
    setMetadata(nextMetadata);
  }

  function updateMetadata(nextMetadata: Partial<RecordingSessionMetadata>) {
    commitMetadata({ ...metadataRef.current, ...nextMetadata });
  }

  function resetMetadata() {
    commitMetadata(initialRecordingSessionMetadata);
  }

  function clearRecordingChunks() {
    chunksRef.current = [];
  }

  function commitPreview(nextPreview: RecordingPlaybackPreviewMetadata) {
    setPreview(nextPreview);
  }

  function revokePreviewObjectUrl() {
    const currentPreviewUrl = previewUrlRef.current;

    if (currentPreviewUrl === null) {
      return;
    }

    URL.revokeObjectURL(currentPreviewUrl);
    previewUrlRef.current = null;
  }

  function resetPreview() {
    revokePreviewObjectUrl();
    commitPreview(initialRecordingPlaybackPreviewMetadata);
  }

  function disposePreviewObjectUrl() {
    revokePreviewObjectUrl();
    previewUrlRef.current = null;
  }

  function createPlaybackPreview() {
    revokePreviewObjectUrl();

    try {
      const mimeType = metadataRef.current.selectedMimeType?.trim() || null;
      const previewBlob =
        mimeType === null
          ? new Blob(chunksRef.current)
          : new Blob(chunksRef.current, { type: mimeType });

      if (previewBlob.size === 0) {
        commitPreview(initialRecordingPlaybackPreviewMetadata);
        return;
      }

      const previewUrl = URL.createObjectURL(previewBlob);
      previewUrlRef.current = previewUrl;
      commitPreview({
        previewAvailable: true,
        previewUrl,
        previewBlobSizeBytes: previewBlob.size,
        previewMimeType: previewBlob.type.trim() === '' ? mimeType : previewBlob.type,
      });
    } catch {
      commitPreview(initialRecordingPlaybackPreviewMetadata);
    }
  }

  function detachRecorderEventHandlers(recorder: MediaRecorder | null) {
    if (recorder === null) {
      return;
    }

    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
  }

  function stopAndDisposeRecorder() {
    const recorder = recorderRef.current;
    if (recorder === null) {
      return;
    }

    recorderRef.current = null;
    detachRecorderEventHandlers(recorder);

    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // The recorder is already on the way out; unmount cleanup should stay best-effort.
      }
    }
  }

  function handleRecorderDataAvailable(event: BlobEvent) {
    const blob = event.data;
    if (!isMountedRef.current || blob.size === 0) {
      return;
    }

    chunksRef.current.push(blob);
    updateMetadata({
      chunkCount: metadataRef.current.chunkCount + 1,
      totalBytes: metadataRef.current.totalBytes + blob.size,
    });
  }

  function handleRecorderStop() {
    if (!isMountedRef.current) {
      return;
    }

    const stoppedAt = Date.now();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    detachRecorderEventHandlers(recorder);
    commitSnapshot(
      transitionRecordingState(snapshotRef.current, 'stopped').snapshot,
    );
    updateMetadata({
      stoppedAt:
        metadataRef.current.startedAt === null
          ? metadataRef.current.stoppedAt
          : metadataRef.current.stoppedAt ?? stoppedAt,
    });
    createPlaybackPreview();
  }

  function handleRecorderError(event: Event) {
    if (!isMountedRef.current) {
      return;
    }

    const errorMessage = getRecorderErrorMessage(
      event,
      'The local MediaRecorder reported an error.',
    );
    const recorder = recorderRef.current;
    recorderRef.current = null;
    detachRecorderEventHandlers(recorder);
    commitSnapshot(
      transitionRecordingState(snapshotRef.current, 'fail', {
        errorMessage,
      }).snapshot,
    );
    updateMetadata({
      stoppedAt:
        metadataRef.current.startedAt === null
          ? metadataRef.current.stoppedAt
          : metadataRef.current.stoppedAt ?? Date.now(),
    });
  }

  function startRecording(stream: MediaStream | null, preferredMimeType?: string | null): boolean {
    if (!canTransitionRecordingState(snapshotRef.current.state, 'prepare')) {
      return false;
    }

    resetPreview();
    commitSnapshot(transitionRecordingState(snapshotRef.current, 'prepare').snapshot);

    if (stream === null) {
      failRecording('Start local preview before starting local recording.');
      return false;
    }

    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();

    if (audioTracks.length === 0 || videoTracks.length === 0) {
      failRecording('The local preview must expose both audio and video tracks before recording.');
      return false;
    }

    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      failRecording('MediaRecorder is unavailable in this browser.');
      return false;
    }

    const mimeType = preferredMimeType?.trim() || null;
    let recorder: MediaRecorder | null = null;

    try {
      recorder = createRecorder(stream, mimeType);
      recorder.ondataavailable = handleRecorderDataAvailable;
      recorder.onerror = handleRecorderError;
      recorder.onstop = handleRecorderStop;
      recorderRef.current = recorder;
      recorder.start(recordingTimesliceMs);
      clearRecordingChunks();
      updateMetadata({
        chunkCount: 0,
        totalBytes: 0,
        selectedMimeType: recorder.mimeType || mimeType,
        startedAt: Date.now(),
        stoppedAt: null,
      });
      commitSnapshot(transitionRecordingState(snapshotRef.current, 'start').snapshot);
      return true;
    } catch (error) {
      if (recorder !== null) {
        detachRecorderEventHandlers(recorder);
      }

      recorderRef.current = null;
      failRecording(
        getRecorderErrorMessage(error, 'Unable to start the local MediaRecorder prototype.'),
      );
      return false;
    }
  }

  function stopRecording(): boolean {
    if (snapshotRef.current.state !== 'recording') {
      return false;
    }

    const recorder = recorderRef.current;
    if (recorder === null) {
      failRecording('The local MediaRecorder stopped unexpectedly.');
      return false;
    }

    commitSnapshot(transitionRecordingState(snapshotRef.current, 'stop').snapshot);

    try {
      recorder.stop();
      return true;
    } catch (error) {
      recorderRef.current = null;
      detachRecorderEventHandlers(recorder);
      failRecording(
        getRecorderErrorMessage(error, 'Unable to stop the local MediaRecorder prototype.'),
      );
      return false;
    }
  }

  function resetRecording(): boolean {
    if (snapshotRef.current.state !== 'stopped' && snapshotRef.current.state !== 'failed') {
      return false;
    }

    resetPreview();
    stopAndDisposeRecorder();
    clearRecordingChunks();
    resetMetadata();
    commitSnapshot(transitionRecordingState(snapshotRef.current, 'reset').snapshot);
    return true;
  }

  function failRecording(fallbackMessage: string) {
    const currentSnapshot = snapshotRef.current;
    const errorMessage = fallbackMessage.trim() === '' ? 'Recording failed.' : fallbackMessage;
    const failedSnapshot = transitionRecordingState(currentSnapshot, 'fail', {
      errorMessage,
    });

    if (failedSnapshot.allowed) {
      commitSnapshot(failedSnapshot.snapshot);
      updateMetadata({
        stoppedAt:
          metadataRef.current.startedAt === null
            ? metadataRef.current.stoppedAt
            : metadataRef.current.stoppedAt ?? Date.now(),
      });
      return;
    }

    const nextSnapshot: RecordingStateSnapshot = {
      state: 'failed',
      errorMessage,
    };
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
  }

  function createRecorder(stream: MediaStream, mimeType: string | null): MediaRecorder {
    try {
      if (mimeType !== null) {
        return new window.MediaRecorder(stream, { mimeType });
      }
    } catch {
      // Fall back to the browser default MIME selection below.
    }

    return new window.MediaRecorder(stream);
  }

  return {
    snapshot,
    chunkCount: metadata.chunkCount,
    totalBytes: metadata.totalBytes,
    selectedMimeType: metadata.selectedMimeType,
    startedAt: metadata.startedAt,
    stoppedAt: metadata.stoppedAt,
    approximateDurationMs,
    previewAvailable: preview.previewAvailable,
    previewUrl: preview.previewUrl,
    previewBlobSizeBytes: preview.previewBlobSizeBytes,
    previewMimeType: preview.previewMimeType,
    startRecording,
    stopRecording,
    resetRecording,
  };
}

function getApproximateDurationMs(
  snapshot: RecordingStateSnapshot,
  metadata: RecordingSessionMetadata,
): number | null {
  if (metadata.startedAt === null) {
    return null;
  }

  const endTime =
    metadata.stoppedAt ??
    (snapshot.state === 'recording' || snapshot.state === 'stopping' ? Date.now() : null);

  if (endTime === null) {
    return null;
  }

  return Math.max(0, endTime - metadata.startedAt);
}

function getRecorderErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const maybeErrorEvent = error as { error?: unknown; message?: unknown };
    if (maybeErrorEvent.error instanceof Error && maybeErrorEvent.error.message.trim() !== '') {
      return maybeErrorEvent.error.message;
    }

    if (
      typeof maybeErrorEvent.message === 'string' &&
      maybeErrorEvent.message.trim() !== ''
    ) {
      return maybeErrorEvent.message;
    }
  }

  return fallbackMessage;
}
