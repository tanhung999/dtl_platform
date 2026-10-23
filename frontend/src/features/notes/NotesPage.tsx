import { ArrowLeft } from 'lucide-react';
import { NotesWidget } from './NotesWidget';
import { NoteFilter } from './noteView';
export function NotesPage({ initialFilter, onBack }: { initialFilter: NoteFilter; onBack: () => void }) {
  return <section className="notes-page" aria-label="Tất cả ghi chú"><header className="notes-page-heading"><button type="button" className="btn btn-outline btn-sm" onClick={onBack}><ArrowLeft size={16} /> Về trang chủ</button><h1>Tất cả ghi chú</h1></header><NotesWidget fullPage initialFilter={initialFilter} /></section>;
}
