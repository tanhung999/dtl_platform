"""Post-commit hints for Workflow; saved grants remain the source of truth."""
import logging
from fastapi import HTTPException

log = logging.getLogger(__name__)


async def notify_workflow_policy_changed(platform_user_id: str, identity_subject: str | None):
    from .account_linking import configuration, workflow_request
    if configuration() is None:
        return
    try:
        await workflow_request('POST', '/policy-changed', body={
            'platform_user_id': platform_user_id,
            'identity_subject': identity_subject or 'platform:' + platform_user_id,
        })
    except HTTPException as error:
        # A lost hint cannot undo a committed grant. Workflow also periodically
        # refreshes its authenticated profile to recover from missed events.
        log.warning('Workflow permission refresh hint failed (HTTP %s)', error.status_code)
