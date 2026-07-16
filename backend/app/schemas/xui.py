from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field


class XuiConnectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    host: str = Field(..., min_length=1)
    port: int = Field(default=3306, ge=1, le=65535)
    db_name: str = Field(..., min_length=1)
    db_user: str = Field(..., min_length=1)
    db_pass: str = Field(..., min_length=1)
    is_default: bool = False


class XuiConnectionUpdate(BaseModel):
    name: str | None = None
    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    db_name: str | None = None
    db_user: str | None = None
    db_pass: str | None = None
    is_default: bool | None = None


class XuiConnectionOut(BaseModel):
    id: UUID
    name: str
    host: str
    port: int
    db_name: str
    db_user: str
    is_default: bool
    last_test_at: datetime | None
    last_test_ok: bool | None
    last_test_error: str | None
    detected_version: str | None
    created_at: datetime


class XuiTestResult(BaseModel):
    ok: bool
    version: str | None = None
    error: str | None = None
    servers: list[dict] = []
    bouquets: list[dict] = []
    categories: dict = {}
