const applicationHomePaths: Record<string, string> = {
  bookingreports: '/dashboard',
};

/** Return the explicit landing page expected by each enterprise application. */
export function applicationHomePath(applicationKey: string): string {
  return applicationHomePaths[applicationKey.trim().toLowerCase()] ?? '/';
}
