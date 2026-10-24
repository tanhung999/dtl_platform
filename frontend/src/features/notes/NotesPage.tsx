import { NotesWidget } from './NotesWidget';
import { NoteFilter } from './noteView';
import { FeatureIcon } from '../../components/FeatureIcon';
export function NotesPage({ initialFilter }: { initialFilter: NoteFilter }) {
  return <section className="notes-page" aria-label="Tất cả ghi chú"><header className="notes-page-heading"><h1><FeatureIcon name="notes" size={30} /> DT My Note</h1></header><NotesWidget fullPage initialFilter={initialFilter} /></section>;
}
