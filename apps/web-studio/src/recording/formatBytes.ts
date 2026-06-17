const byteUnits = ['B', 'KB', 'MB', 'GB'] as const;

export function formatBytes(byteCount: number): string {
  if (!Number.isFinite(byteCount) || byteCount <= 0) {
    return '0 B';
  }

  if (byteCount < 1024) {
    return `${Math.round(byteCount)} B`;
  }

  let value = byteCount;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < byteUnits.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${byteUnits[unitIndex]}`;
}
