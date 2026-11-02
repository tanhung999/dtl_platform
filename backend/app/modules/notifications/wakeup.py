"""Post-commit workspace events wake this process's reminder scheduler."""
import asyncio

_event = None
_loop = None


def reminder_wakeup():
    global _event, _loop
    loop = asyncio.get_running_loop()
    if _loop is not loop:
        _event, _loop = asyncio.Event(), loop
    return _event


def wake_reminders():
    try:
        reminder_wakeup().set()
    except RuntimeError:
        pass  # Synchronous tooling may broadcast without an event loop.
