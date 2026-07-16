from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class ChannelBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str | None = None
    group_name: str | None = None
    logo_url: str | None = None
    stream_url: str | None = None
    epg_id: str | None = None
    is_active: bool = True


class ChannelCreate(ChannelBase):
    pass


class ChannelUpdate(BaseModel):
    name: str | None = None
    category: str | None = None
    group_name: str | None = None
    logo_url: str | None = None
    stream_url: str | None = None
    epg_id: str | None = None
    is_active: bool | None = None


class ChannelOut(ChannelBase):
    id: UUID
    created_at: datetime
    updated_at: datetime


class ChannelList(BaseModel):
    items: list[ChannelOut]
    total: int


class BulkAction(BaseModel):
    ids: list[UUID]
    action: str = Field(..., pattern=r"^(activate|deactivate|delete)$")
