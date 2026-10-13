from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.core.database import get_db
from app.core.realtime import stream
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/workspace", tags=["Workspace realtime"])

@router.get("/stream")
async def workspace_stream(request: Request, user=Depends(get_current_user), db=Depends(get_db)):
    user_id = user.id
    await db.close()
    return StreamingResponse(stream(user_id, request), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
