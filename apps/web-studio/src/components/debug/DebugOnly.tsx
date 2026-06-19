import type { PropsWithChildren } from 'react';
import { isDebugEnabled } from '../../lib/debug';

export function DebugOnly({ children }: PropsWithChildren) {
  if (!isDebugEnabled()) {
    return null;
  }

  return <>{children}</>;
}
