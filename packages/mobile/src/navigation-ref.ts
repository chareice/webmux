import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './navigation';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingThreadTarget: RootStackParamList['ThreadDetail'] | null = null;

export function openThreadDetail(
  target: RootStackParamList['ThreadDetail'],
): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate('ThreadDetail', target);
    return;
  }

  pendingThreadTarget = target;
}

export function flushPendingThreadDetail(isLoggedIn: boolean): void {
  if (!isLoggedIn || !pendingThreadTarget || !navigationRef.isReady()) {
    return;
  }

  navigationRef.navigate('ThreadDetail', pendingThreadTarget);
  pendingThreadTarget = null;
}
