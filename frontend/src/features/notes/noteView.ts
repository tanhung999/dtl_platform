export type NoteFilter = 'all' | 'scheduled' | 'pinned';

export function shortNoteDate(timestamp: string) {
  const parts = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).formatToParts(new Date(timestamp));
  return `${parts.find(part => part.type === 'day')?.value}/${parts.find(part => part.type === 'month')?.value}`;
}
