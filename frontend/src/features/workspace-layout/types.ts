export type LayoutKind = 'apps' | 'bookmarks' | 'notes';
export interface Order { ids: string[]; version: number }
export type Layout = Record<LayoutKind, Order>;
