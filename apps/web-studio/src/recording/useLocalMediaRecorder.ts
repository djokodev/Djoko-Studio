import { useEffect, useRef, useState } from 'react';
import {
  appendLocalRecordingChunkManifestEntry,
  buildLocalRecordingSummary,
  createLocalRecordingId,
  createLocalRecordingManifest,
  finalizeLocalRecordingManifest,
  localRecordingSourceKind,
  markLocalRecordingManifestFailed,
  transitionLocalRecordingManifestStatus,
  type LocalRecordingManifest,
  type LocalRecordingSummary,
} from './recordingManifest';
import {
  canTransitionRecordingState,
  createInitialRecordingSnapshot,
  transitionRecordingState,
  type RecordingStateSnapshot,
} from './recordingStateMachine';

const recordingTimesliceMs = 1000;

interface LocalRecordingPlaybackPreviewMetadata {
  previewAvailable: boolean;
  previewUrl: string | null;
  previewBlobSizeBytes: number;
  previewMimeType: string | null;
}

const initialRecordingPlaybackPreviewMetadata: LocalRecordingPlaybackPreviewMetadata = {
  previewAvailable: false,
  previewUrl: null,
  previewBlobSizeBytes: 0,
  previewMimeType: null,
};

export interface LocalMediaRecorderController {
  snapshot: RecordingStateSnapshot;
  manifest: LocalRecordingManifest | null;
  summary: LocalRecordingSummary;
  previewUrl: string | null;
  previewMimeType: string | null;
  startRecording: (stream: MediaStream | null, preferredMimeType?: string | null) => boolean;
  stopRecording: () => boolean;
  resetRecording: () => boolean;
}

export function useLocalMediaRecorder(): LocalMediaRecorderController {
  const [snapshot, setSnapshot] = useState<RecordingStateSnapshot>(createInitialRecordingSnapshot());
  const [manifest, setManifest] = useState<LocalRecordingManifest | null>(null);
  const [preview, setPreview] = useState<LocalRecordingPlaybackPreviewMetadata>(
    initialRecordingPlaybackPreviewMetadata,
  );
  const snapshotRef = useRef(snapshot);
  const manifestRef = useRef(manifest);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const isMountedRef = useRef(true);
  const [, setDurationTick] = useState(0);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      disposePreviewObjectUrl();
      stopAndDisposeRecorder();
      clearRecordingChunks();
      setManifest(null);
      setPreview(initialRecordingPlaybackPreviewMetadata);
    };
    // The cleanup uses the current refs directly so it stays correct on unmount.
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

  const summary = buildLocalRecordingSummary(manifest, preview, snapshot.state);

  function commitSnapshot(nextSnapshot: RecordingStateSnapshot) {
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
  }

  function commitManifest(nextManifest: LocalRecordingManifest | null) {
    manifestRef.current = nextManifest;
    setManifest(nextManifest);
  }

  function commitPreview(nextPreview: LocalRecordingPlaybackPreviewMetadata) {
    setPreview(nextPreview);
  }

  function clearRecordingChunks() {
    chunksRef.current = [];
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

  function clearRecordingArtifacts() {
    clearRecordingChunks();
    resetPreview();
    commitManifest(null);
  }

  function createPlaybackPreview() {
    revokePreviewObjectUrl();

    try {
      const selectedMimeType = manifestRef.current?.selectedMimeType?.trim() || null;
      const previewBlob =
        selectedMimeType === null
          ? new Blob(chunksRef.current)
          : new Blob(chunksRef.current, { type: selectedMimeType });

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
        previewMimeType: previewBlob.type.trim() === '' ? selectedMimeType : previewBlob.type,
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
        // Best-effort cleanup during unmount or reset.
      }
    }
  }

  function handleRecorderDataAvailable(event: BlobEvent) {
    const blob = event.data;
    const currentManifest = manifestRef.current;

    if (!isMountedRef.current || blob.size === 0 || currentManifest === null) {
      return;
    }

    chunksRef.current.push(blob);
    const nextManifest = appendLocalRecordingChunkManifestEntry(
      currentManifest,
      blob,
      Date.now(),
    );
    commitManifest(nextManifest);
  }

  function handleRecorderStop() {
    if (!isMountedRef.current) {
      return;
    }

    const stoppedAt = Date.now();
    const recorder = recorderRef.current;
    const currentManifest = manifestRef.current;
    recorderRef.current = null;
    detachRecorderEventHandlers(recorder);

    if (currentManifest !== null) {
      commitManifest(finalizeLocalRecordingManifest(currentManifest, stoppedAt));
    }

    commitSnapshot(transitionRecordingState(snapshotRef.current, 'stopped').snapshot);
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
    const currentManifest = manifestRef.current;
    recorderRef.current = null;
    detachRecorderEventHandlers(recorder);

    if (currentManifest !== null) {
      commitManifest(markLocalRecordingManifestFailed(currentManifest, Date.now()));
    }

    commitSnapshot(
      transitionRecordingState(snapshotRef.current, 'fail', {
        errorMessage,
      }).snapshot,
    );
  }

  function startRecording(stream: MediaStream | null, preferredMimeType?: string | null): boolean {
    if (!canTransitionRecordingState(snapshotRef.current.state, 'prepare')) {
      return false;
    }

    commitSnapshot(transitionRecordingState(snapshotRef.current, 'prepare').snapshot);
    clearRecordingArtifacts();

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

      const startedAt = Date.now();
      const recordingId = createLocalRecordingId();
      const nextManifest = createLocalRecordingManifest({
        recordingId,
        selectedMimeType: recorder.mimeType.trim() === '' ? mimeType : recorder.mimeType,
        startedAt,
        sourceKind: localRecordingSourceKind,
      });

      commitManifest(nextManifest);
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

    const currentManifest = manifestRef.current;
    if (currentManifest !== null) {
      commitManifest(
        transitionLocalRecordingManifestStatus(currentManifest, 'stopping', Date.now()),
      );
    }

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

    stopAndDisposeRecorder();
    clearRecordingArtifacts();
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
    } else {
      const nextSnapshot: RecordingStateSnapshot = {
        state: 'failed',
        errorMessage,
      };
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
    }

    const currentManifest = manifestRef.current;
    if (currentManifest !== null) {
      commitManifest(markLocalRecordingManifestFailed(currentManifest, Date.now()));
    }
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
    manifest,
    summary,
    previewUrl: preview.previewUrl,
    previewMimeType: preview.previewMimeType,
    startRecording,
    stopRecording,
    resetRecording,
  };
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
