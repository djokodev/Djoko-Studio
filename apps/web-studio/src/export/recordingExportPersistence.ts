const exportStorageKeyPrefix = 'djoko-export:last-export-id:';

export function getPersistedExportId(recordingId: string): string | null {
  const storage = getLocalStorage();
  if (storage === null) {
    return null;
  }

  const normalizedRecordingId = recordingId.trim();
  if (normalizedRecordingId === '') {
    return null;
  }

  const value = storage.getItem(exportStorageKey(normalizedRecordingId));
  return value !== null && value.trim() !== '' ? value.trim() : null;
}

export function savePersistedExportId(recordingId: string, exportId: string): void {
  const storage = getLocalStorage();
  const normalizedRecordingId = recordingId.trim();
  const normalizedExportId = exportId.trim();

  if (storage === null || normalizedRecordingId === '' || normalizedExportId === '') {
    return;
  }

  storage.setItem(exportStorageKey(normalizedRecordingId), normalizedExportId);
}

export function clearPersistedExportId(recordingId: string): void {
  const storage = getLocalStorage();
  const normalizedRecordingId = recordingId.trim();

  if (storage === null || normalizedRecordingId === '') {
    return;
  }

  storage.removeItem(exportStorageKey(normalizedRecordingId));
}

function exportStorageKey(recordingId: string): string {
  return `${exportStorageKeyPrefix}${recordingId}`;
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
