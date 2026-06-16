export type RecordingState =
  | 'idle'
  | 'preparing'
  | 'recording'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type RecordingEvent =
  | 'prepare'
  | 'start'
  | 'stop'
  | 'stopped'
  | 'fail'
  | 'reset';

export interface RecordingStateSnapshot {
  state: RecordingState;
  errorMessage: string | null;
}

export interface RecordingTransitionResult {
  snapshot: RecordingStateSnapshot;
  changed: boolean;
  allowed: boolean;
  reason?: string;
}

export interface RecordingTransitionOptions {
  errorMessage?: string;
}

const recordingStateTransitions: Record<RecordingState, Partial<Record<RecordingEvent, RecordingState>>> = {
  idle: {
    prepare: 'preparing',
  },
  preparing: {
    start: 'recording',
    fail: 'failed',
  },
  recording: {
    stop: 'stopping',
    fail: 'failed',
  },
  stopping: {
    stopped: 'stopped',
    fail: 'failed',
  },
  stopped: {
    reset: 'idle',
  },
  failed: {
    reset: 'idle',
  },
};

export function createInitialRecordingSnapshot(): RecordingStateSnapshot {
  return {
    state: 'idle',
    errorMessage: null,
  };
}

export function getAllowedRecordingEvents(state: RecordingState): RecordingEvent[] {
  return Object.keys(recordingStateTransitions[state]) as RecordingEvent[];
}

export function canTransitionRecordingState(
  state: RecordingState,
  event: RecordingEvent,
): boolean {
  return getAllowedRecordingEvents(state).includes(event);
}

export function transitionRecordingState(
  snapshot: RecordingStateSnapshot,
  event: RecordingEvent,
  options: RecordingTransitionOptions = {},
): RecordingTransitionResult {
  const nextState = recordingStateTransitions[snapshot.state][event];

  if (nextState === undefined) {
    return {
      snapshot: { ...snapshot },
      changed: false,
      allowed: false,
      reason: `Event ${event} is not allowed from ${snapshot.state}.`,
    };
  }

  if (nextState === 'failed') {
    return {
      snapshot: {
        state: nextState,
        errorMessage: normalizeFailureMessage(options.errorMessage ?? snapshot.errorMessage),
      },
      changed: true,
      allowed: true,
    };
  }

  return {
    snapshot: {
      state: nextState,
      errorMessage: null,
    },
    changed: true,
    allowed: true,
  };
}

function normalizeFailureMessage(message: string | null | undefined): string {
  const trimmedMessage = message?.trim();

  if (trimmedMessage) {
    return trimmedMessage;
  }

  return 'Recording failed.';
}
