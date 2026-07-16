from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class BannerCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    subtitle: str | None = Field(default=None, max_length=300)
    theme: str = Field(default="dark", pattern=r"^(dark|light|custom)$")
    template: str = Field(default="default", max_length=64)
    logo_url: str | None = None


class BannerOut(BaseModel):
    id: UUID
    title: str
    subtitle: str | None
    theme: str
    template: str
    logo_url: str | None
    image_url: str | None
    status: str
    created_at: datetime


class BannerList(BaseModel):
    items: list[BannerOut]
    total: int
