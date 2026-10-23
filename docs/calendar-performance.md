# Calendar, tasks and notes performance

Calendar grids load at most 500 events/notes and 500 tasks per server request.
Personal and shared calendars support loading subsequent pages explicitly. Every
read goes to the server; there is no persistent cache of search or calendar data.
Existing request sharing combines identical concurrent GETs, isolates sessions,
and invalidates in-flight snapshots after writes or realtime version changes.

Recurring series are stored once. Counts use interval arithmetic, and grids merge
ordered occurrence iterators, projecting only the requested page plus one
look-ahead per series. The same overlap rules apply to personal/shared calendars,
including exclusive end boundaries and multi-day all-day occurrences. Note
previews stop after finding their next ongoing/upcoming occurrence.

Each later page rechecks ownership or the current sharing grant and privacy.
Pages have stable sort orders. The client cancels obsolete requests, separates
shared data by owner, grant version and access epoch, and merges identities by
kind and ID. Refresh rereads the pages already loaded, keeping the existing grid
mounted until the replacement is ready. Switching ranges resets pagination.
Concurrent mutations invalidate the collection and restart that read; pagination
does not hold a database snapshot across separate HTTP requests.

Weekly timed/all-day layouts reuse calculated placements when only the clock or
an unrelated dialog changes. Agenda refresh preserves its DOM and scroll. Notes
have a keyboard-accessible title button, bounded request timeouts and a single
explicit message for searches shorter than two characters. Reminder summaries
identify the next relative reminder and its daily/weekly cadence, or explain a
one-time all-day reminder.

Validation includes recurrence boundary/page tests, mixed public/private shared
pages, browser grids with 515 events and 515 tasks, refresh/scroll preservation,
and the existing theme and schedule-editor checks.

An isolated Python microbenchmark (1,000 daily series over 93 days, first 500
results, with tracemalloc enabled) measured projection/selection at 3.6201 s and
39,410,604 peak bytes for full expansion versus 0.2271 s and 1,292,391 bytes for
bounded merging. Both returned the same IDs and a total of 93,000 occurrences.
These are measurements of that computation, not end-to-end API latency or a
production throughput guarantee. No existing user data was deleted or converted.
