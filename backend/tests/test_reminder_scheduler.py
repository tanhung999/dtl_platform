import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from tests.support import api_case  # Ensure isolated configuration before importing the worker.
from app.modules.notifications.worker import run_worker
from app.core.realtime import broadcast


class Session:
    def __init__(self, next_at):
        self.scalar=AsyncMock(side_effect=lambda *args: next_at())
        self.commit=AsyncMock()
    async def __aenter__(self): return self
    async def __aexit__(self,*args): return False


class ReminderSchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_nearest_job_is_delivered_without_fifteen_second_poll(self):
        calls=[]; second=asyncio.Event()
        deadline=datetime.now(timezone.utc)+timedelta(seconds=.35)
        session=Session(lambda: deadline if len(calls)==1 else None)
        async def deliver(db):
            calls.append(asyncio.get_running_loop().time())
            if len(calls)>=2: second.set()
            return 0
        with patch('app.modules.notifications.worker.async_session_maker',return_value=session), patch('app.modules.notifications.worker.deliver_batch',side_effect=deliver), patch('app.modules.notifications.worker.prepare_changes',new=AsyncMock(return_value={})):
            async with run_worker():
                await asyncio.wait_for(second.wait(),3)
        self.assertGreaterEqual(calls[1]-calls[0],.2)
        self.assertLess(calls[1]-calls[0],3)

    async def test_idle_worker_wakes_on_committed_change_without_browser_subscriber(self):
        first=asyncio.Event(); second=asyncio.Event(); calls=[]
        async def deliver(db):
            calls.append(1)
            (first if len(calls)==1 else second).set()
            return 0
        session=Session(lambda:None)
        with patch('app.modules.notifications.worker.async_session_maker',return_value=session), patch('app.modules.notifications.worker.deliver_batch',side_effect=deliver), patch('app.modules.notifications.worker.prepare_changes',new=AsyncMock(return_value={})):
            async with run_worker():
                await asyncio.wait_for(first.wait(),2)
                await asyncio.sleep(.1)
                self.assertEqual(len(calls),1,'No fast idle polling')
                broadcast({'user_id':'not-subscribed','topics':['notifications']})
                await asyncio.wait_for(second.wait(),2)
