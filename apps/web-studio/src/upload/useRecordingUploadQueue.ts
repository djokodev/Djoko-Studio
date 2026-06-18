import { useEffect, useRef, useState } from 'react';
import type { PersistedLocalRecordingRecord } from '../recording/recordingPersistence';
import { listPersistedLocalRecordingChunks } from '../recording/recordingPersistence';
import { computeBlobSha256Hex, createRecordingUploadApiClient, RecordingUploadClientError } from './recordingUploadApiClient';
import {
  deriveServerConfirmedUploadChunkIndexes,
  resolveRecordingUploadStartState,
} from './recordingUploadCoordinator';
import {
  markChunkAlreadyPresent,
  markChunkUploading,
  markChunkUploaded,
  markRecordingUploadCanceled,
  markRecordingUploadComplete,
  markRecordingUploadFailed,
  mergeRecordingUploadServerStatus,
  setRecordingUploadInitializing,
  setRecordingUploadPaused,
  setRecordingUploadRetrying,
  setRecordingUploadSessionReady,
  summarizeRecordingUploadProgress,
  type RecordingUploadState,
} from './recordingUploadState';
import {
  deletePersistedRecordingUploadState,
  getPersistedRecordingUploadState,
  listPersistedRecordingUploadStates,
  saveRecordingUploadState,
} from './recordingUploadPersistence';

const uploadClient = createRecordingUploadApiClient();

interface RecordingUploadQueueState {
  statesByRecordingId: Record<string, RecordingUploadState>;
  loading: boolean;
  errorMessage: string | null;
  summaryRevision: number;
}

export interface RecordingUploadQueueItem {
  recording: PersistedLocalRecordingRecord;
  state: RecordingUploadState | null;
  progressLabel: string;
  uploadLabel: string;
  statusLabel: string;
  canUpload: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  canRetry: boolean;
}

export function useRecordingUploadQueue(persistedRecordings: PersistedLocalRecordingRecord[]) {
  const [queueState, setQueueState] = useState<RecordingUploadQueueState>({
    statesByRecordingId: {},
    loading: false,
    errorMessage: null,
    summaryRevision: 0,
  });
  const runTokensRef = useRef<Record<string, number>>({});

  useEffect(() => {
    let isActive = true;

    setQueueState((current) => ({
      ...current,
      loading: true,
      errorMessage: null,
    }));

    void refreshUploadStates()
      .then((statesByRecordingId) => {
        if (!isActive) {
          return;
        }

        setQueueState({
          statesByRecordingId,
          loading: false,
          errorMessage: null,
          summaryRevision: 0,
        });
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setQueueState((current) => ({
          ...current,
          loading: false,
          errorMessage: getErrorMessage(error, 'Unable to read upload queue state.'),
        }));
      });

    return () => {
      isActive = false;
    };
  }, [persistedRecordings]);

  const items = persistedRecordings
    .map((recording) => {
      const state = queueState.statesByRecordingId[recording.recordingId] ?? null;
      const summary = state ? summarizeRecordingUploadProgress(state) : null;
      const uploadLabel = getUploadLabel(state);
      const statusLabel = getStatusLabel(state);
      const progressLabel = summary
        ? `${summary.uploadedChunkCount}/${summary.expectedChunkCount} chunks, ${formatBytes(summary.uploadedBytes)} / ${formatBytes(summary.expectedTotalBytes)}`
        : 'Not started';

      return {
        recording,
        state,
        progressLabel,
        uploadLabel,
        statusLabel,
        canUpload: recording.manifest.chunkCount > 0,
        canPause: state !== null && state.status === 'uploading',
        canResume:
          state !== null &&
          (state.status === 'paused' || state.status === 'failed' || state.status === 'incomplete' || state.status === 'retrying'),
        canCancel:
          state !== null &&
          (state.status === 'ready' ||
            state.status === 'uploading' ||
            state.status === 'paused' ||
            state.status === 'incomplete' ||
            state.status === 'failed' ||
            state.status === 'retrying'),
        canRetry: state !== null && (state.status === 'failed' || state.status === 'incomplete'),
      } satisfies RecordingUploadQueueItem;
    })
    .filter((item) => item.recording.manifest.sessionId && item.recording.manifest.participantId && item.recording.manifest.role);

  async function refreshUploadStates(): Promise<Record<string, RecordingUploadState>> {
    const states = await listPersistedRecordingUploadStates();
    const nextStatesByRecordingId: Record<string, RecordingUploadState> = {};

    for (const state of states) {
      nextStatesByRecordingId[state.recordingId] = state;
    }

    return nextStatesByRecordingId;
  }

  async function persistState(state: RecordingUploadState): Promise<RecordingUploadState> {
    await saveRecordingUploadState(state);
    setQueueState((current) => ({
      ...current,
      statesByRecordingId: {
        ...current.statesByRecordingId,
        [state.recordingId]: state,
      },
      summaryRevision: current.summaryRevision + 1,
    }));
    return state;
  }

  async function startUpload(recording: PersistedLocalRecordingRecord): Promise<void> {
    await runUpload(recording, { resumeExisting: false });
  }

  async function resumeUpload(recording: PersistedLocalRecordingRecord): Promise<void> {
    await runUpload(recording, { resumeExisting: true });
  }

  async function pauseUpload(recordingId: string): Promise<void> {
    invalidateRun(recordingId);
    const state = await getPersistedRecordingUploadState(recordingId);
    if (state === null) {
      return;
    }

    await persistState(setRecordingUploadPaused(state, Date.now()));
  }

  async function cancelUpload(recordingId: string): Promise<void> {
    invalidateRun(recordingId);
    const state = await getPersistedRecordingUploadState(recordingId);
    if (state === null) {
      return;
    }

    const nextState = markRecordingUploadCanceled(state, Date.now());
    await persistState(nextState);

    if (nextState.uploadId !== null) {
      try {
        await uploadClient.cancelUploadSession(recordingId, nextState.uploadId);
      } catch {
        // Cancel is best-effort; local queue state remains terminal either way.
      }
    }
  }

  return {
    items,
    loading: queueState.loading,
    errorMessage: queueState.errorMessage,
    summaryRevision: queueState.summaryRevision,
    refreshUploadStates: async () => {
      const statesByRecordingId = await refreshUploadStates();
      setQueueState((current) => ({
        ...current,
        statesByRecordingId,
        loading: false,
        errorMessage: null,
      }));
    },
    startUpload,
    resumeUpload,
    pauseUpload,
    cancelUpload,
  };

  async function runUpload(
    recording: PersistedLocalRecordingRecord,
    options: { resumeExisting: boolean },
  ): Promise<void> {
    const localChunks = await listPersistedLocalRecordingChunks(recording.recordingId);
    if (localChunks.length === 0) {
      return;
    }

    const persistedState = await getPersistedRecordingUploadState(recording.recordingId);
    const { state: baseState, shouldResetPersistedState } = resolveRecordingUploadStartState({
      recording,
      existingState: persistedState,
      resumeExisting: options.resumeExisting,
      now: Date.now(),
    });

    if (shouldResetPersistedState) {
      await deletePersistedRecordingUploadState(recording.recordingId);
    }

    let nextState = baseState;
    nextState = setRecordingUploadInitializing(nextState, Date.now());
    await persistState(nextState);

    const token = nextRunToken(recording.recordingId);

    try {
      const chunkSizeBytes = deriveNominalChunkSizeBytes(
        recording.manifest.totalBytes,
        recording.manifest.chunkCount,
      );
      if (!options.resumeExisting || nextState.uploadId === null) {
        const createResponse = await uploadClient.createUploadSession({
          recordingId: recording.recordingId,
          sessionId: recording.manifest.sessionId ?? '',
          participantId: recording.manifest.participantId ?? '',
          role: recording.manifest.role ?? 'host',
          totalBytes: recording.manifest.totalBytes,
          expectedChunkCount: recording.manifest.chunkCount,
          chunkSizeBytes,
          mimeType: recording.manifest.selectedMimeType,
          manifestVersion: 1,
          clientCreatedAt: new Date().toISOString(),
        });

        nextState = setRecordingUploadSessionReady(nextState, {
          uploadId: createResponse.uploadId,
          sessionId: createResponse.sessionId,
          participantId: createResponse.participantId,
          role: createResponse.role,
          now: Date.now(),
        });
        await persistState(nextState);
      } else {
        const serverStatus = await uploadClient.getUploadSessionStatus(
          recording.recordingId,
          nextState.uploadId,
        );
        const confirmedChunkIndexes = deriveServerConfirmedUploadChunkIndexes({
          expectedChunkCount: serverStatus.expectedChunkCount,
          missingChunkIndexes: serverStatus.missingChunkIndexes,
          rejectedChunkIndexes: serverStatus.rejectedChunkIndexes,
        });

        nextState = mergeRecordingUploadServerStatus(nextState, {
          status: serverStatus.status,
          uploadId: serverStatus.uploadId,
          sessionId: serverStatus.sessionId,
          participantId: serverStatus.participantId,
          role: serverStatus.role,
          uploadedChunkIndexes: confirmedChunkIndexes,
          rejectedChunkIndexes: serverStatus.rejectedChunkIndexes,
          uploadedBytes: serverStatus.uploadedBytes,
          completedAt: serverStatus.completedAt === null ? null : Date.parse(serverStatus.completedAt),
          now: Date.now(),
        });
        await persistState(nextState);
      }

      for (const chunk of localChunks) {
        if (!isCurrentRun(recording.recordingId, token)) {
          return;
        }

        const currentState = (await getPersistedRecordingUploadState(recording.recordingId)) ?? nextState;
        if (currentState.status === 'canceled' || currentState.status === 'uploaded') {
          return;
        }

        const currentChunk = currentState.chunks[chunk.chunkEntry.chunkIndex];
        if (
          currentChunk !== undefined &&
          (currentChunk.status === 'uploaded' || currentChunk.status === 'already_present')
        ) {
          continue;
        }

        nextState = markChunkUploading(currentState, chunk.chunkEntry.chunkIndex, Date.now());
        await persistState(nextState);

        const chunkChecksum = await computeBlobSha256Hex(chunk.blob);
        const response = await uploadClient.uploadChunk({
          recordingId: recording.recordingId,
          uploadId: nextState.uploadId ?? '',
          chunkIndex: chunk.chunkEntry.chunkIndex,
          chunkSizeBytes: chunk.blob.size,
          totalBytes: recording.manifest.totalBytes,
          mimeType: chunk.blob.type || recording.manifest.selectedMimeType || 'application/octet-stream',
          idempotencyKey: `${recording.recordingId}:${nextState.uploadId}:${chunk.chunkEntry.chunkIndex}`,
          body: chunk.blob,
          chunkChecksum,
        });

        nextState = response.alreadyPresent
          ? markChunkAlreadyPresent(nextState, response.chunkIndex, response.uploadedBytes, Date.now())
          : markChunkUploaded(nextState, response.chunkIndex, response.uploadedBytes, Date.now());
        await persistState(nextState);
      }

      if (!isCurrentRun(recording.recordingId, token)) {
        return;
      }

      const completion = await uploadClient.completeUploadSession(
        recording.recordingId,
        nextState.uploadId ?? '',
      );

      nextState = mergeRecordingUploadServerStatus(nextState, {
        status: completion.status,
        uploadId: completion.uploadId,
        sessionId: completion.sessionId,
        participantId: completion.participantId,
        role: completion.role,
        uploadedChunkIndexes:
          completion.missingChunkIndexes.length === 0
            ? nextState.chunks
                .map((chunk) => chunk.chunkIndex)
                .filter((chunkIndex) => {
                  const chunk = nextState.chunks[chunkIndex];
                  return (
                    chunk !== undefined &&
                    (chunk.status === 'uploaded' || chunk.status === 'already_present')
                  );
                })
            : [],
        rejectedChunkIndexes: completion.rejectedChunkIndexes,
        uploadedBytes: completion.uploadedBytes,
        completedAt: completion.status === 'uploaded' ? Date.now() : null,
        now: Date.now(),
      });

      nextState = completion.complete
        ? markRecordingUploadComplete(nextState, Date.now())
        : nextState;

      await persistState(nextState);
    } catch (error) {
      const currentState = (await getPersistedRecordingUploadState(recording.recordingId)) ?? nextState;
      const message = getErrorMessage(error, 'Upload failed.');
      const nextFailure =
        error instanceof RecordingUploadClientError && error.retryable
          ? setRecordingUploadRetrying(currentState, Date.now())
          : markRecordingUploadFailed(currentState, message, Date.now());

      await persistState(nextFailure);
    } finally {
      invalidateRun(recording.recordingId);
    }
  }

  function nextRunToken(recordingId: string): number {
    const nextToken = (runTokensRef.current[recordingId] ?? 0) + 1;
    runTokensRef.current[recordingId] = nextToken;
    return nextToken;
  }

  function invalidateRun(recordingId: string) {
    runTokensRef.current[recordingId] = (runTokensRef.current[recordingId] ?? 0) + 1;
  }

  function isCurrentRun(recordingId: string, token: number): boolean {
    return runTokensRef.current[recordingId] === token;
  }
}

function deriveNominalChunkSizeBytes(totalBytes: number, chunkCount: number): number {
  if (chunkCount <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(totalBytes / chunkCount));
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function getUploadLabel(state: RecordingUploadState | null): string {
  if (state === null) {
    return 'Upload local copy';
  }

  switch (state.status) {
    case 'not_started':
      return 'Upload local copy';
    case 'initializing':
      return 'Preparing upload...';
    case 'ready':
      return 'Upload local copy';
    case 'uploading':
      return 'Uploading...';
    case 'paused':
      return 'Resume upload';
    case 'retrying':
      return 'Retry upload';
    case 'incomplete':
      return 'Resume upload';
    case 'uploaded':
      return 'Uploaded';
    case 'failed':
      return 'Retry upload';
    case 'canceled':
      return 'Upload local copy';
  }
}

function getStatusLabel(state: RecordingUploadState | null): string {
  if (state === null) {
    return 'not_started';
  }

  return state.status;
}

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallbackMessage;
}
