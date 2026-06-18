import { useEffect, useRef, useState } from 'react';
import {
  appendLocalRecordingChunkManifestEntry,
  buildLocalRecordingSummary,
  createLocalRecordingId,
  createLocalRecordingManifest,
  getLocalRecordingMetadataBlockingReasons,
  getLocalRecordingParticipantMetadata,
  doesLocalRecordingMatchParticipantMetadata,
  finalizeLocalRecordingManifest,
  localRecordingSourceKind,
  markLocalRecordingManifestFailed,
  transitionLocalRecordingManifestStatus,
  type LocalRecordingChunkManifestEntry,
  type LocalRecordingParticipantMetadata,
  type LocalRecordingParticipantMetadataInput,
  type LocalRecordingPersistenceStatus,
  type LocalRecordingPersistenceSupportStatus,
  type LocalRecordingManifest,
  type LocalRecordingSummary,
} from './recordingManifest';
import {
  type LocalRecordingIntegrityReport,
} from './recordingIntegrity';
import {
  buildPersistedLocalRecordingBlob,
  deleteAllPersistedLocalRecordings,
  deletePersistedLocalRecording,
  getPersistedLocalRecording,
  getLocalRecordingPersistenceSupport,
  getLocalRecordingStorageSummary,
  listPersistedLocalRecordings,
  listPersistedLocalRecordingChunks,
  saveLocalRecordingChunk,
  saveLocalRecordingManifest,
  verifyAllPersistedLocalRecordings,
  verifyPersistedLocalRecording,
  type LocalRecordingStorageSummary,
  type PersistedLocalRecordingRecord,
} from './recordingPersistence';
import {
  getBrowserStorageEstimate,
  type BrowserStorageEstimate,
} from './browserStorageEstimate';
import {
  canTransitionRecordingState,
  createInitialRecordingSnapshot,
  transitionRecordingState,
  type RecordingStateSnapshot,
} from './recordingStateMachine';

const recordingTimesliceMs = 1000;

export type LocalStorageSummaryStatus = 'idle' | 'loading' | 'ready' | 'failed';
export type LocalIntegrityCheckStatus = 'idle' | 'checking' | 'ready' | 'failed';

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

interface LocalStorageSummaryState {
  status: LocalStorageSummaryStatus;
  errorMessage: string | null;
  localStorageSummary: LocalRecordingStorageSummary | null;
  browserStorageEstimate: BrowserStorageEstimate | null;
}

interface LocalIntegrityState {
  status: LocalIntegrityCheckStatus;
  errorMessage: string | null;
  reportsByRecordingId: Record<string, LocalRecordingIntegrityReport>;
}

interface BeforeUnloadWarningInputs {
  recordingState: RecordingStateSnapshot['state'];
  persistenceStatus: LocalRecordingPersistenceStatus;
  previewAvailable: boolean;
  persistedRecordingCount: number;
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

const initialLocalStorageSummaryState: LocalStorageSummaryState = {
  status: 'idle',
  errorMessage: null,
  localStorageSummary: null,
  browserStorageEstimate: null,
};

const initialLocalIntegrityState: LocalIntegrityState = {
  status: 'idle',
  errorMessage: null,
  reportsByRecordingId: {},
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
  localIntegrityReports: LocalRecordingIntegrityReport[];
  integrityCheckStatus: LocalIntegrityCheckStatus;
  integrityCheckError: string | null;
  checkLocalRecordingIntegrity: (
    recordingId: string,
  ) => Promise<LocalRecordingIntegrityReport | null>;
  checkAllLocalRecordingIntegrity: () => Promise<LocalRecordingIntegrityReport[]>;
  discardPersistedRecording: (recordingId: string) => Promise<boolean>;
  localStorageSummary: LocalRecordingStorageSummary | null;
  browserStorageEstimate: BrowserStorageEstimate | null;
  storageSummaryStatus: LocalStorageSummaryStatus;
  storageSummaryError: string | null;
  refreshLocalStorageSummary: () => Promise<void>;
  clearAllPersistedLocalRecordings: () => Promise<boolean>;
  startRecording: (
    stream: MediaStream | null,
    preferredMimeType?: string | null,
    options?: LocalRecordingParticipantMetadata | null,
  ) => boolean;
  stopRecording: () => boolean;
  resetRecording: () => boolean;
}

export function useLocalMediaRecorder(
  recordingContext?: LocalRecordingParticipantMetadataInput | null,
): LocalMediaRecorderController {
  const [snapshot, setSnapshot] = useState<RecordingStateSnapshot>(createInitialRecordingSnapshot());
  const [manifest, setManifest] = useState<LocalRecordingManifest | null>(null);
  const [preview, setPreview] = useState<LocalRecordingPlaybackPreviewMetadata>(
    initialRecordingPlaybackPreviewMetadata,
  );
  const [recoveredPreview, setRecoveredPreview] = useState<LocalRecordingRecoveredPreviewMetadata>(
    initialRecoveredPreviewMetadata,
  );
  const [storageSummaryState, setStorageSummaryState] = useState<LocalStorageSummaryState>(
    initialLocalStorageSummaryState,
  );
  const [integrityState, setIntegrityState] = useState<LocalIntegrityState>(
    initialLocalIntegrityState,
  );
  const snapshotRef = useRef(snapshot);
  const manifestRef = useRef(manifest);
  const recoveredPreviewRef = useRef(recoveredPreview);
  const storageSummaryRequestIdRef = useRef(0);
  const integrityCheckRequestIdRef = useRef(0);
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
  const currentRecordingContext = getLocalRecordingParticipantMetadata(recordingContext);

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

  const visiblePersistedRecordings = persistenceState.persistedRecordings.filter((record) =>
    doesLocalRecordingMatchParticipantMetadata(record.manifest, currentRecordingContext),
  );
  const visiblePersistedRecordingCount = visiblePersistedRecordings.length;

  const summary = buildLocalRecordingSummary(manifest, preview, snapshot.state, {
    supportStatus: persistenceState.supportStatus,
    status: persistenceState.status,
    errorMessage: persistenceState.errorMessage,
    persistedRecordingCount: visiblePersistedRecordingCount,
    currentRecordingPersisted: persistenceState.currentRecordingPersisted,
  });

  const beforeUnloadWarningInputsRef = useRef<BeforeUnloadWarningInputs>({
    recordingState: snapshot.state,
    persistenceStatus: persistenceState.status,
    previewAvailable: summary.previewAvailable,
    persistedRecordingCount: visiblePersistedRecordingCount,
  });

  useEffect(() => {
    isMountedRef.current = true;
    void initializePersistenceSupport();

    return () => {
      isMountedRef.current = false;
      disposePreviewObjectUrl();
      disposeRecoveredPreviewObjectUrl();
      stopAndDisposeRecorder();
      currentRecordingIdRef.current = null;
      setManifest(null);
      setPreview(initialRecordingPlaybackPreviewMetadata);
      setRecoveredPreview(initialRecoveredPreviewMetadata);
      setStorageSummaryState(initialLocalStorageSummaryState);
      setIntegrityState(initialLocalIntegrityState);
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

  useEffect(() => {
    beforeUnloadWarningInputsRef.current = {
      recordingState: snapshot.state,
      persistenceStatus: persistenceState.status,
      previewAvailable: summary.previewAvailable,
      persistedRecordingCount: visiblePersistedRecordingCount,
    };
  }, [
    snapshot.state,
    summary.previewAvailable,
    persistenceState.status,
    visiblePersistedRecordingCount,
  ]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const shouldWarn = shouldWarnBeforeUnload(beforeUnloadWarningInputsRef.current);

      if (shouldWarn) {
        event.preventDefault();
        event.returnValue = 'You have unsaved local recordings that are not uploaded. Are you sure you want to leave?';
        return event.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const localStorageSummary = storageSummaryState.localStorageSummary;
  const browserStorageEstimate = storageSummaryState.browserStorageEstimate;
  const localIntegrityReports = Object.values(integrityState.reportsByRecordingId);

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

  function commitStorageSummaryState(
    nextStorageSummaryState: Partial<LocalStorageSummaryState>,
  ) {
    setStorageSummaryState((currentStorageSummaryState) => ({
      ...currentStorageSummaryState,
      ...nextStorageSummaryState,
    }));
  }

  function commitIntegrityState(nextIntegrityState: Partial<LocalIntegrityState>) {
    setIntegrityState((currentIntegrityState) => ({
      ...currentIntegrityState,
      ...nextIntegrityState,
    }));
  }

  function upsertIntegrityReport(report: LocalRecordingIntegrityReport) {
    setIntegrityState((currentIntegrityState) => ({
      ...currentIntegrityState,
      reportsByRecordingId: {
        ...currentIntegrityState.reportsByRecordingId,
        [report.recordingId]: report,
      },
    }));
  }

  function clearIntegrityReport(recordingId: string) {
    setIntegrityState((currentIntegrityState) => {
      if (!(recordingId in currentIntegrityState.reportsByRecordingId)) {
        return currentIntegrityState;
      }

      const nextReportsByRecordingId = { ...currentIntegrityState.reportsByRecordingId };
      delete nextReportsByRecordingId[recordingId];

      return {
        ...currentIntegrityState,
        reportsByRecordingId: nextReportsByRecordingId,
      };
    });
  }

  function clearAllIntegrityReports() {
    setIntegrityState((currentIntegrityState) => ({
      ...currentIntegrityState,
      reportsByRecordingId: {},
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
            ? records.some(
                (record) =>
                  record.recordingId === activeRecordingId &&
                  doesLocalRecordingMatchParticipantMetadata(
                    record.manifest,
                    currentRecordingContext,
                  ),
              )
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

  async function refreshLocalStorageSummary(): Promise<void> {
    const requestId = storageSummaryRequestIdRef.current + 1;
    storageSummaryRequestIdRef.current = requestId;
    commitStorageSummaryState({
      status: 'loading',
      errorMessage: null,
    });

    try {
      const [storageSummary, browserEstimate] = await Promise.all([
        getLocalRecordingStorageSummary(),
        getBrowserStorageEstimate(),
      ]);

      if (!isMountedRef.current || storageSummaryRequestIdRef.current !== requestId) {
        return;
      }

      commitStorageSummaryState({
        status: storageSummary.supportStatus === 'failed' ? 'failed' : 'ready',
        errorMessage: storageSummary.supportErrorMessage,
        localStorageSummary: storageSummary,
        browserStorageEstimate: browserEstimate,
      });
    } catch (error) {
      if (!isMountedRef.current || storageSummaryRequestIdRef.current !== requestId) {
        return;
      }

      commitStorageSummaryState({
        status: 'failed',
        errorMessage: getRecorderErrorMessage(
          error,
          'Unable to refresh the browser storage summary.',
        ),
        localStorageSummary: null,
        browserStorageEstimate: null,
      });
    }
  }

  async function verifyAndStoreIntegrityReport(
    recordingId: string,
  ): Promise<LocalRecordingIntegrityReport | null> {
    const normalizedRecordingId = recordingId.trim();

    if (normalizedRecordingId === '') {
      return Promise.resolve(null);
    }

    try {
      const report = await verifyPersistedLocalRecording(normalizedRecordingId);

      if (!isMountedRef.current) {
        return null;
      }

      upsertIntegrityReport(report);
      return report;
    } catch {
      if (!isMountedRef.current) {
        return null;
      }

      return null;
    }
  }

  async function verifyAndStoreAllIntegrityReports(): Promise<LocalRecordingIntegrityReport[]> {
    const reports = await verifyAllPersistedLocalRecordings();

    if (!isMountedRef.current) {
      return reports;
    }

    setIntegrityState((currentIntegrityState) => {
      const nextReportsByRecordingId: Record<string, LocalRecordingIntegrityReport> = {};

      for (const report of reports) {
        nextReportsByRecordingId[report.recordingId] = report;
      }

      return {
        ...currentIntegrityState,
        reportsByRecordingId: nextReportsByRecordingId,
      };
    });

    return reports;
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

    if (recordingId !== undefined && currentRecoveredPreview.recordingId !== recordingId) {
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
      await refreshLocalStorageSummary();
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
      await refreshLocalStorageSummary();
      return;
    }

    commitPersistenceState({
      supportStatus: 'failed',
      status: 'failed',
      errorMessage: support.errorMessage,
      persistedRecordings: [],
      currentRecordingPersisted: false,
      });
    await refreshLocalStorageSummary();
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

  function enqueuePersistenceTask<T>(task: () => Promise<T>): Promise<T> {
    const nextTask = persistenceQueueRef.current.then(task);
    persistenceQueueRef.current = nextTask.then(
      () => undefined,
      () => undefined,
    );

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
        await refreshLocalStorageSummary();
        await verifyAndStoreIntegrityReport(recordingId);
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
        await refreshLocalStorageSummary();
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
        await refreshLocalStorageSummary();
        await verifyAndStoreIntegrityReport(recordingId);
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
      await refreshLocalStorageSummary();
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

        clearIntegrityReport(recordingId);
        commitIntegrityState({
          status: 'idle',
          errorMessage: null,
        });

        await refreshPersistedRecordingList();
        await refreshLocalStorageSummary();
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

  function clearAllPersistedLocalRecordings(): Promise<boolean> {
    if (persistenceState.supportStatus === 'unavailable') {
      return Promise.resolve(false);
    }

    const hasPersistedRecordings = persistenceState.persistedRecordings.length > 0;
    if (!hasPersistedRecordings) {
      return Promise.resolve(false);
    }

    commitStorageSummaryState({
      status: 'loading',
      errorMessage: null,
    });
    commitPersistenceState({
      status: 'persisting',
      errorMessage: null,
      currentRecordingPersisted: false,
    });

    return enqueuePersistenceTask(async () => {
      try {
        await deleteAllPersistedLocalRecordings();

        if (!isMountedRef.current) {
          return;
        }

        if (recoveredPreviewRef.current.recordingId !== null) {
          clearRecoveredPreviewState(recoveredPreviewRef.current.recordingId);
        }

        clearAllIntegrityReports();
        commitIntegrityState({
          status: 'idle',
          errorMessage: null,
        });

        await refreshPersistedRecordingList();
        await refreshLocalStorageSummary();
        commitPersistenceState({
          status: getIdlePersistenceStatus(persistenceState.supportStatus),
          currentRecordingPersisted: false,
        });
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        commitStorageSummaryState({
          status: 'failed',
          errorMessage: getRecorderErrorMessage(
            error,
            'Unable to clear the persisted local recordings.',
          ),
        });
        commitPersistenceState({
          status: 'failed',
          errorMessage: getRecorderErrorMessage(
            error,
            'Unable to clear the persisted local recordings.',
          ),
        });
      }
    })
      .then(() => true)
      .catch(() => false);
  }

  async function checkLocalRecordingIntegrity(
    recordingId: string,
  ): Promise<LocalRecordingIntegrityReport | null> {
    const normalizedRecordingId = recordingId.trim();
    if (normalizedRecordingId === '') {
      return null;
    }

    const requestId = integrityCheckRequestIdRef.current + 1;
    integrityCheckRequestIdRef.current = requestId;
    commitIntegrityState({
      status: 'checking',
      errorMessage: null,
    });

    return enqueuePersistenceTask(async () => {
      const report = await verifyAndStoreIntegrityReport(normalizedRecordingId);

      if (!isMountedRef.current || integrityCheckRequestIdRef.current !== requestId) {
        return report;
      }

      if (report === null) {
        commitIntegrityState({
          status: 'failed',
          errorMessage: 'Unable to verify the persisted local recording.',
        });
        return null;
      }

      commitIntegrityState({
        status: 'ready',
        errorMessage: null,
      });

      return report;
    });
  }

  async function checkAllLocalRecordingIntegrity(): Promise<LocalRecordingIntegrityReport[]> {
    const support = await getLocalRecordingPersistenceSupport();
    if (support.state !== 'supported') {
      commitIntegrityState({
        status: 'failed',
        errorMessage:
          support.state === 'unavailable'
            ? 'IndexedDB persistence is unavailable in this browser.'
            : support.errorMessage ??
              'IndexedDB persistence is available but the local recordings could not be verified.',
      });

      return [];
    }

    const requestId = integrityCheckRequestIdRef.current + 1;
    integrityCheckRequestIdRef.current = requestId;
    commitIntegrityState({
      status: 'checking',
      errorMessage: null,
    });

    return enqueuePersistenceTask(async () => {
      try {
        const reports = await verifyAndStoreAllIntegrityReports();

        if (!isMountedRef.current || integrityCheckRequestIdRef.current !== requestId) {
          return reports;
        }

        commitIntegrityState({
          status: 'ready',
          errorMessage: null,
        });

        return reports;
      } catch (error) {
        if (!isMountedRef.current || integrityCheckRequestIdRef.current !== requestId) {
          return [];
        }

        commitIntegrityState({
          status: 'failed',
          errorMessage: getRecorderErrorMessage(
            error,
            'Unable to verify the persisted local recordings.',
          ),
        });

        return [];
      }
    });
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
    resetPreview();
    commitManifest(null);
    currentRecordingIdRef.current = null;
    commitPersistenceState({
      currentRecordingPersisted: false,
    });
  }

  async function createPlaybackPreviewFromPersistence(recordingId: string) {
    revokePreviewObjectUrl();

    try {
      const previewBlob = await buildPersistedLocalRecordingBlob(recordingId);
      const currentManifest = manifestRef.current;

      if (previewBlob === null || previewBlob.size === 0) {
        commitPreview(initialRecordingPlaybackPreviewMetadata);
        return;
      }

      const previewUrl = URL.createObjectURL(previewBlob);
      previewUrlRef.current = previewUrl;
      commitPreview({
        previewAvailable: true,
        previewUrl,
        previewBlobSizeBytes: previewBlob.size,
        previewMimeType:
          previewBlob.type.trim() === ''
            ? currentManifest?.selectedMimeType ?? null
            : previewBlob.type,
      });
    } catch {
      commitPreview(initialRecordingPlaybackPreviewMetadata);
    }
  }

  async function finalizeCurrentRecordingPreview(recordingId: string) {
    await persistenceQueueRef.current;

    if (!isMountedRef.current || currentRecordingIdRef.current !== recordingId) {
      return;
    }

    await createPlaybackPreviewFromPersistence(recordingId);
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

    if (currentManifest !== null) {
      void finalizeCurrentRecordingPreview(currentManifest.recordingId);
    }
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

  function startRecording(
    stream: MediaStream | null,
    preferredMimeType?: string | null,
    options?: LocalRecordingParticipantMetadata | null,
  ): boolean {
    if (!canTransitionRecordingState(snapshotRef.current.state, 'prepare')) {
      return false;
    }

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

    const metadataBlockingReasons = getLocalRecordingMetadataBlockingReasons(options);
    const metadata = getLocalRecordingParticipantMetadata(options);
    if (metadata === null) {
      failRecording(metadataBlockingReasons.join(' '));
      return false;
    }

    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      failRecording('MediaRecorder is unavailable in this browser.');
      return false;
    }

    commitSnapshot(transitionRecordingState(snapshotRef.current, 'prepare').snapshot);
    clearRecordingArtifacts();

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
        sessionId: metadata.sessionId,
        participantId: metadata.participantId,
        role: metadata.role,
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
    persistedRecordings: visiblePersistedRecordings,
    localIntegrityReports,
    integrityCheckStatus: integrityState.status,
    integrityCheckError: integrityState.errorMessage,
    checkLocalRecordingIntegrity,
    checkAllLocalRecordingIntegrity,
    discardPersistedRecording,
    localStorageSummary,
    browserStorageEstimate,
    storageSummaryStatus: storageSummaryState.status,
    storageSummaryError: storageSummaryState.errorMessage,
    refreshLocalStorageSummary,
    clearAllPersistedLocalRecordings,
    startRecording,
    stopRecording,
    resetRecording,
  };
}

export function shouldWarnBeforeUnload(input: {
  recordingState: RecordingStateSnapshot['state'];
  persistenceStatus: LocalRecordingPersistenceStatus;
  previewAvailable: boolean;
  persistedRecordingCount: number;
}): boolean {
  return (
    input.recordingState === 'recording' ||
    input.recordingState === 'stopping' ||
    input.persistenceStatus === 'persisting' ||
    input.previewAvailable ||
    input.persistedRecordingCount > 0
  );
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
