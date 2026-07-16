from datetime import datetime
from uuid import UUID
from typing import Any
from pydantic import BaseModel, Field


class XtreamSourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    host: str = Field(..., min_length=1)
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    kind: str = Field(default="live", pattern=r"^(live|vod|series)$")


class XtreamSourceOut(BaseModel):
    id: UUID
    name: str
    host: str
    username: str
    kind: str
    is_active: bool
    last_sync_at: datetime | None
    created_at: datetime


class SyncJobOut(BaseModel):
    id: UUID
    job_type: str
    source_id: UUID | None
    status: str
    progress: int
    payload: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    error: str | None = None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime


class TriggerSyncRequest(BaseModel):
    source_id: UUID


class SyncJobList(BaseModel):
    items: list[SyncJobOut]
    total: int
