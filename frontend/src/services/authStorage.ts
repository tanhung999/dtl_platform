export const TOKEN_KEY = 'dtl_platform_token';
export const USER_KEY = 'dtl_platform_user';

export function storedUserId(value: string | null): string {
  try {
    const id = value ? JSON.parse(value)?.id : undefined;
    return typeof id === 'string' ? id : '';
  } catch { return ''; }
}

/** Cookie credentials are shared by tabs even when the stored bearer token is empty. */
export function authStorageChanged(event: Pick<StorageEvent, 'key' | 'oldValue' | 'newValue'>): boolean {
  if (event.key === null) return true;
  if (event.key === TOKEN_KEY) return event.oldValue !== event.newValue;
  return event.key === USER_KEY && storedUserId(event.oldValue) !== storedUserId(event.newValue);
}
