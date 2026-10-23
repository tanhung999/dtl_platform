import { ComponentProps } from 'react';
import { EventModal } from './EventModal';
import { CalendarNoteModal } from '../../note-scheduling/CalendarNoteModal';

export function CalendarItemModal(props: ComponentProps<typeof EventModal>) {
  return props.event?.scheduled_note_id
    ? <CalendarNoteModal key={props.event.scheduled_note_id} noteId={props.event.scheduled_note_id} occurrenceAt={props.draft.occurrenceAt} onClose={props.onClose} />
    : <EventModal {...props} />;
}
