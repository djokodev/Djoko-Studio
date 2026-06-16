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
  type LocalRecordingChunkManifestEntry,
  type LocalRecordingPersistenceStatus,
  type LocalRecordingPersistenceSupportStatus,
  type LocalRecordingManifest,
  type LocalRecordingSummary,
} from './recordingManifest';
import {
  buildPersistedLocalRecordingBlob,
  deletePersistedLocalRecording,
  getPersistedLocalRecording,
  getLocalRecordingPersistenceSupport,
  listPersistedLocalRecordings,
  listPersistedLocalRecordingChunks,
  saveLocalRecordingChunk,
  saveLocalRecordingManifest,
  type PersistedLocalRecordingRecord,
} from './recordingPersistence';
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

type LocalRecordingRecoveredPreviewStatus = 'idle' | 'loading' | 'ready' | 'failed';

interface LocalRecordingRecoveredPreviewMetadata {
  status: LocalRecordingRecoveredPreviewStatus;
  recordingId: string | null;
  errorMessage: string | null;
  previewAvailable: boolean;
  previewUrl: string | null;
  previewBlobSizeBytes: number;
  previewMimeType: string | null;
}

interface LocalRecordingPersistenceState {
  supportStatus: LocalRecordingPersistenceSupportStatus;
  status: LocalRecordingPersistenceStatus;
  errorMessage: string | null;
  persistedRecordings: PersistedLocalRecordingRecord[];
  currentRecordingPersisted: boolean;
}

const initialRecordingPlaybackPreviewMetadata: LocalRecordingPlaybackPreviewMetadata = {
  previewAvailable: false,
  previewUrl: null,
  previewBlobSizeBytes: 0,
  previewMimeType: null,
};

const initialRecoveredPreviewMetadata: LocalRecordingRecoveredPreviewMetadata = {
  status: 'idle',
  recordingId: null,
  errorMessage: null,
  previewAvailable: false,
  previewUrl: null,
  previewBlobSizeBytes: 0,
  previewMimeType: null,
};

const initialPersistenceState: LocalRecordingPersistenceState = {
  supportStatus: 'not_checked',
  status: 'not_checked',
  errorMessage: null,
  persistedRecordings: [],
  currentRecordingPersisted: false,
};

export interface LocalMediaRecorderController {
  snapshot: RecordingStateSnapshot;
  manifest: LocalRecordingManifest | null;
  summary: LocalRecordingSummary;
  previewUrl: string | null;
  previewMimeType: string | null;
  recoveredPreview: LocalRecordingRecoveredPreviewMetadata;
  loadRecoveredPreview: (recordingId: string) => Promise<boolean>;
  clearRecoveredPreview: (recordingId?: string) => void;
  persistenceSupportStatus: LocalRecordingPersistenceSupportStatus;
  persistenceErrorMessage: string | null;
  persistedRecordings: PersistedLocalRecordingRecord[];
  discardPersistedRecording: (recordingId: string) => Promise<boolean>;
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
  const [recoveredPreview, setRecoveredPreview] = useState<LocalRecordingRecoveredPreviewMetadata>(
    initialRecoveredPreviewMetadata,
  );
  const snapshotRef = useRef(snapshot);
  const manifestRef = useRef(manifest);
  const recoveredPreviewRef = useRef(recoveredPreview);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);
  const recoveredPreviewUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const currentRecordingIdRef = useRef<string | null>(null);
  const recoveredPreviewRequestIdRef = useRef(0);
  const persistenceQueueRef = useRef(Promise.resolve());
  const isMountedRef = useRef(true);
  const [persistenceState, setPersistenceState] = useState<LocalRecordingPersistenceState>(
    initialPersistenceState,
  );
  const [, setDurationTick] = useState(0);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  useEffect(() => {
    recoveredPreviewRef.current = recoveredPreview;
  }, [recoveredPreview]);

  useEffect(() => {
    recoveredPreviewUrlRef.current = recoveredPreview.previewUrl;
  }, [recoveredPreview.previewUrl]);

  useEffect(() => {
    isMountedRef.current = true;
    void initializePersistenceSupport();

    return () => {
      isMountedRef.current = false;
      disposePreviewObjectUrl();
      disposeRecoveredPreviewObjectUrl();
      stopAndDisposeRecorder();
      clearRecordingChunks();
      currentRecordingIdRef.current = null;
      setManifest(null);
      setPreview(initialRecordingPlaybackPreviewMetadata);
      setRecoveredPreview(initialRecoveredPreviewMetadata);
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

  const summary = buildLocalRecordingSummary(manifest, preview, snapshot.state, {
    supportStatus: persistenceState.supportStatus,
    status: persistenceState.status,
    errorMessage: persistenceState.errorMessage,
    persistedRecordingCount: persistenceState.persistedRecordings.length,
    currentRecordingPersisted: persistenceState.currentRecordingPersisted,
  });

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

  function commitPersistenceState(
    nextPersistenceState: Partial<LocalRecordingPersistenceState>,
  ) {
    setPersistenceState((currentPersistenceState) => ({
      ...currentPersistenceState,
      ...nextPersistenceState,
    }));
  }

  function getIdlePersistenceStatus(
    supportStatus: LocalRecordingPersistenceSupportStatus,
  ): LocalRecordingPersistenceStatus {
    if (supportStatus === 'supported') {
      return 'available';
    }

    if (supportStatus === 'unavailable') {
      return 'unsupported';
    }

    if (supportStatus === 'failed') {
      return 'failed';
    }

    return 'not_checked';
  }

  function refreshPersistedRecordingList(activeRecordingId = currentRecordingIdRef.current) {
    if (persistenceState.supportStatus === 'unavailable') {
      return Promise.resolve();
    }

    return listPersistedLocalRecordings()
      .then((records) => {
        if (!isMountedRef.current) {
          return;
        }

        const currentRecordingPersisted =
          activeRecordingId !== null
            ? records.some((record) => record.recordingId === activeRecordingId)
            : false;

        commitPersistenceState({
          supportStatus: 'supported',
          persistedRecordings: records,
          currentRecordingPersisted,
          status: currentRecordingPersisted ? 'persisted' : 'available',
          errorMessage: null,
        });
      })
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }

        commitPersistenceState({
          supportStatus: 'failed',
          errorMessage: getRecorderErrorMessage(
            error,
            'IndexedDB persistence is available but the local recordings list could not be read.',
          ),
          status: 'failed',
        });
      });
  }

  function revokeRecoveredPreviewObjectUrl() {
    const currentPreviewUrl = recoveredPreviewUrlRef.current;

    if (currentPreviewUrl === null) {
      return;
    }

    URL.revokeObjectURL(currentPreviewUrl);
    recoveredPreviewUrlRef.current = null;
  }

  function disposeRecoveredPreviewObjectUrl() {
    revokeRecoveredPreviewObjectUrl();
    recoveredPreviewUrlRef.current = null;
  }

  function commitRecoveredPreview(nextRecoveredPreview: LocalRecordingRecoveredPreviewMetadata) {
    recoveredPreviewRef.current = nextRecoveredPreview;
    setRecoveredPreview(nextRecoveredPreview);
  }

  function clearRecoveredPreviewState(recordingId?: string) {
    const currentRecoveredPreview = recoveredPreviewRef.current;

    if (
      recordingId !== undefined &&
      currentRecoveredPreview.recordingId !== recordingId &&
      currentRecoveredPreview.status !== 'loading'
    ) {
      return;
    }

    recoveredPreviewRequestIdRef.current += 1;
    revokeRecoveredPreviewObjectUrl();
    commitRecoveredPreview(initialRecoveredPreviewMetadata);
  }

  async function initializePersistenceSupport() {
    const support = await getLocalRecordingPersistenceSupport();

    if (!isMountedRef.current) {
      return;
    }

    if (support.state === 'supported') {
      commitPersistenceState({
        supportStatus: 'supported',
        status: 'available',
        errorMessage: null,
      });
      await refreshPersistedRecordingList();
      return;
    }

    if (support.state === 'unavailable') {
      commitPersistenceState({
        supportStatus: 'unavailable',
        status: 'unsupported',
        errorMessage: null,
        persistedRecordings: [],
        currentRecordingPersisted: false,
      });
      return;
    }

    commitPersistenceState({
      supportStatus: 'failed',
      status: 'failed',
      errorMessage: support.errorMessage,
      persistedRecordings: [],
      currentRecordingPersisted: false,
      });
  }

  async function loadRecoveredPreview(recordingId: string): Promise<boolean> {
    const normalizedRecordingId = recordingId.trim();
    if (normalizedRecordingId === '') {
      return false;
    }

    const requestId = recoveredPreviewRequestIdRef.current + 1;
    recoveredPreviewRequestIdRef.current = requestId;
    revokeRecoveredPreviewObjectUrl();
    commitRecoveredPreview({
      status: 'loading',
      recordingId: normalizedRecordingId,
      errorMessage: null,
      previewAvailable: false,
      previewUrl: null,
      previewBlobSizeBytes: 0,
      previewMimeType: null,
    });

    if (persistenceState.supportStatus === 'unavailable') {
      if (!isMountedRef.current || recoveredPreviewRequestIdRef.current !== requestId) {
        return false;
      }

      commitRecoveredPreview({
        status: 'failed',
        recordingId: normalizedRecordingId,
        errorMessage: 'IndexedDB persistence is unavailable in this browser.',
        previewAvailable: false,
        previewUrl: null,
        previewBlobSizeBytes: 0,
        previewMimeType: null,
      });
      return false;
    }

    try {
      const persistedRecording = await getPersistedLocalRecording(normalizedRecordingId);
      if (!isMountedRef.current || recoveredPreviewRequestIdRef.current !== requestId) {
        return false;
      }

      if (persistedRecording === null) {
        commitRecoveredPreview({
          status: 'failed',
          recordingId: normalizedRecordingId,
          errorMessage: 'Persisted local recording could not be found.',
          previewAvailable: false,
          previewUrl: null,
          previewBlobSizeBytes: 0,
          previewMimeType: null,
        });
        return false;
      }

      const chunks = await listPersistedLocalRecordingChunks(normalizedRecordingId);
      if (!isMountedRef.current || recoveredPreviewRequestIdRef.current !== requestId) {
        return false;
      }

      if (chunks.length === 0) {
        commitRecoveredPreview({
          status: 'failed',
          recordingId: normalizedRecordingId,
          errorMessage: 'No persisted chunks available for preview.',
          previewAvailable: false,
          previewUrl: null,
          previewBlobSizeBytes: 0,
          previewMimeType: null,
        });
        return false;
      }

      const previewBlob = await buildPersistedLocalRecordingBlob(normalizedRecordingId);
      if (!isMountedRef.current || recoveredPreviewRequestIdRef.current !== requestId) {
        return false;
      }

      if (previewBlob === null || previewBlob.size === 0) {
        commitRecoveredPreview({
          status: 'failed',
          recordingId: normalizedRecordingId,
          errorMessage: 'No persisted chunks available for preview.',
          previewAvailable: false,
          previewUrl: null,
          previewBlobSizeBytes: 0,
          previewMimeType: null,
        });
        return false;
      }

      const previewUrl = URL.createObjectURL(previewBlob);
      recoveredPreviewUrlRef.current = previewUrl;
      commitRecoveredPreview({
        status: 'ready',
        recordingId: normalizedRecordingId,
        errorMessage: null,
        previewAvailable: true,
        previewUrl,
        previewBlobSizeBytes: previewBlob.size,
        previewMimeType:
          previewBlob.type.trim() === ''
            ? persistedRecording.manifest.selectedMimeType
            : previewBlob.type,
      });
      return true;
    } catch (error) {
      if (!isMountedRef.current || recoveredPreviewRequestIdRef.current !== requestId) {
        return false;
      }

      commitRecoveredPreview({
        status: 'failed',
        recordingId: normalizedRecordingId,
        errorMessage: getRecorderErrorMessage(
          error,
          'Unable to recover the persisted local recording preview.',
        ),
        previewAvailable: false,
        previewUrl: null,
        previewBlobSizeBytes: 0,
        previewMimeType: null,
      });
      return false;
    }
  }

  function enqueuePersistenceTask(task: () => Promise<void>) {
    const nextTask = persistenceQueueRef.current.then(task);
    persistenceQueueRef.current = nextTask.catch(() => undefined);

    return nextTask;
  }

  function persistCurrentManifestState(
    nextManifest: LocalRecordingManifest,
    recordingId = nextManifest.recordingId,
  ) {
    if (persistenceState.supportStatus === 'unavailable') {
      commitPersistenceState({
        status: getIdlePersistenceStatus(persistenceState.supportStatus),
        currentRecordingPersisted: false,
      });
      return;
    }

    commitPersistenceState({
      status: 'persisting',
      errorMessage: null,
      currentRecordingPersisted: false,
    });

    void enqueuePersistenceTask(async () => {
      try {
        await saveLocalRecordingManifest(nextManifest);
        if (!isMountedRef.current || currentRecordingIdRef.current !== recordingId) {
          return;
        }

        await refreshPersistedRecordingList(recordingId);
      } catch (error) {
        if (!isMountedRef.current || currentRecordingIdRef.current !== recordingId) {
          return;
        }

        commitPersistenceState({
          status: 'failed',
          errorMessage: getRecorderErrorMessage(
            error,
            'Unable to save the local recording manifest to IndexedDB.',
          ),
        });
      }
    });
  }

  function persistLocalRecordingChunk(
    recordingId: string,
    chunkEntry: LocalRecordingChunkManifestEntry,
    blob: Blob,
    nextManifest: LocalRecordingManifest,
  ) {
    if (persistenceState.supportStatus === 'unavailable') {
      commitPersistenceState({
        status: getIdlePersistenceStatus(persistenceState.supportStatus),
        currentRecordingPersisted: false,
      });
      return;
    }

    commitPersistenceState({
      status: 'persisting',
      errorMessage: null,
      currentRecordingPersisted: false,
    });

    void enqueuePersistenceTask(async () => {
      let chunkSaveError: unknown = null;
      let manifestSaveError: unknown = null;

      try {
        await saveLocalRecordingChunk(recordingId, chunkEntry, blob);
      } catch (error) {
        chunkSaveError = error;
      }

      try {
        await saveLocalRecordingManifest(nextManifest);
      } catch (error) {
        manifestSaveError = error;
      }

      if (!isMountedRef.current || currentRecordingIdRef.current !== recordingId) {
        return;
      }

      if (chunkSaveError === null && manifestSaveError === null) {
        await refreshPersistedRecordingList(recordingId);
        return;
      }

      commitPersistenceState({
        status: 'failed',
        errorMessage: getRecorderErrorMessage(
          chunkSaveError ?? manifestSaveError,
          'Unable to save the local recording chunk to IndexedDB.',
        ),
      });

      await refreshPersistedRecordingList(recordingId);
    });
  }

  function discardPersistedRecording(recordingId: string): Promise<boolean> {
    if (recordingId.trim() === '') {
      return Promise.resolve(false);
    }

    if (persistenceState.supportStatus === 'unavailable') {
      return Promise.resolve(false);
    }

    commitPersistenceState({
      status: 'persisting',
      errorMessage: null,
    });

    return enqueuePersistenceTask(async () => {
      try {
        await deletePersistedLocalRecording(recordingId);

        if (!isMountedRef.current) {
          return;
        }

        if (recoveredPreviewRef.current.recordingId === recordingId) {
          clearRecoveredPreviewState(recordingId);
        }

        if (currentRecordingIdRef.current === recordingId) {
          currentRecordingIdRef.current = null;
        }

        await refreshPersistedRecordingList();
        commitPersistenceState({
          status: getIdlePersistenceStatus(persistenceState.supportStatus),
          currentRecordingPersisted: false,
        });
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        commitPersistenceState({
          status: 'failed',
          errorMessage: getRecorderErrorMessage(
            error,
            'Unable to discard the persisted local recording.',
          ),
        });
      }
    })
      .then(() => true)
      .catch(() => false);
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
    currentRecordingIdRef.current = null;
    commitPersistenceState({
      currentRecordingPersisted: false,
    });
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
    const chunkEntry = nextManifest.chunks.at(-1) ?? null;
    commitManifest(nextManifest);

    if (chunkEntry !== null) {
      persistLocalRecordingChunk(nextManifest.recordingId, chunkEntry, blob, nextManifest);
    }
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
      const finalizedManifest = finalizeLocalRecordingManifest(currentManifest, stoppedAt);
      commitManifest(finalizedManifest);
      persistCurrentManifestState(finalizedManifest, finalizedManifest.recordingId);
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
      const failedManifest = markLocalRecordingManifestFailed(currentManifest, Date.now());
      commitManifest(failedManifest);
      persistCurrentManifestState(failedManifest, failedManifest.recordingId);
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

      currentRecordingIdRef.current = recordingId;
      commitManifest(nextManifest);
      persistCurrentManifestState(nextManifest, recordingId);
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
      const stoppingManifest = transitionLocalRecordingManifestStatus(
        currentManifest,
        'stopping',
        Date.now(),
      );
      commitManifest(stoppingManifest);
      persistCurrentManifestState(stoppingManifest, stoppingManifest.recordingId);
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

    const recordingIdToDiscard = currentRecordingIdRef.current ?? manifestRef.current?.recordingId ?? null;

    stopAndDisposeRecorder();
    clearRecordingArtifacts();
    commitSnapshot(transitionRecordingState(snapshotRef.current, 'reset').snapshot);

    if (recordingIdToDiscard !== null) {
      void discardPersistedRecording(recordingIdToDiscard);
    }

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
      const failedManifest = markLocalRecordingManifestFailed(currentManifest, Date.now());
      commitManifest(failedManifest);
      persistCurrentManifestState(failedManifest, failedManifest.recordingId);
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
    recoveredPreview,
    loadRecoveredPreview,
    clearRecoveredPreview: clearRecoveredPreviewState,
    persistenceSupportStatus: persistenceState.supportStatus,
    persistenceErrorMessage: persistenceState.errorMessage,
    persistedRecordings: persistenceState.persistedRecordings,
    discardPersistedRecording,
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
