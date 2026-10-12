import { useSyncExternalStore } from 'react';
import { cookApi } from '../services/cookApi';

const subscribe = (callback: () => void) => cookApi.subscribeSession(callback);
const getSnapshot = () => (cookApi.isLoggedIn() ? cookApi.getUsername() : '');

/** Name of the signed-in user, or '' when logged out. Updates on login, logout and token expiry. */
export function useLoginUser(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}
