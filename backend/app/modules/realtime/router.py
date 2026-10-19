from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.core.database import get_db, async_session_maker
from app.core.workspace_versions import read_versions
from app.core.realtime import stream
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/workspace", tags=["Workspace realtime"])

@router.get("/stream")
async def workspace_stream(request: Request, user=Depends(get_current_user), db=Depends(get_db, scope="function")):
    user_id = user.id
    await db.close()
    async def load_versions():
        async with async_session_maker() as session:
            return await read_versions(session, user_id)
    return StreamingResponse(stream(user_id, request, load_versions), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
