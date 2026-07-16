from datetime import datetime
from uuid import UUID
from typing import Any, Literal
from pydantic import BaseModel, Field


SourceType = Literal["m3u_url", "m3u_file", "xtream_api"]


class XtreamSourceCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    source_type: SourceType = "xtream_api"
    # xtream_api
    host: str | None = None
    username: str | None = None
    password: str | None = None
    kind: str = Field(default="live", pattern=r"^(live|vod|series|all)$")
    # m3u
    m3u_url: str | None = None
    m3u_content: str | None = None
    # target
    xui_connection_id: UUID | None = None
    mapping: dict[str, Any] | None = None
    auto_sync: bool = False
    auto_sync_cron: str | None = None


class XtreamSourceUpdate(BaseModel):
    name: str | None = None
    host: str | None = None
    username: str | None = None
    password: str | None = None
    m3u_url: str | None = None
    m3u_content: str | None = None
    xui_connection_id: UUID | None = None
    mapping: dict[str, Any] | None = None
    auto_sync: bool | None = None
    auto_sync_cron: str | None = None
    is_active: bool | None = None


class XtreamSourceOut(BaseModel):
    id: UUID
    name: str
    source_type: str
    host: str | None
    username: str | None
    kind: str
    m3u_url: str | None
    xui_connection_id: UUID | None
    mapping: dict[str, Any] | None
    auto_sync: bool
    auto_sync_cron: str | None
    is_active: bool
    last_sync_at: datetime | None
    last_auto_run_at: datetime | None
    created_at: datetime


class SyncJobOut(BaseModel):
    id: UUID
    job_type: str
    source_id: UUID | None
    status: str
    progress: int
    total_items: int = 0
    inserted: int = 0
    skipped: int = 0
    errors: int = 0
    log_tail: str | None = None
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
