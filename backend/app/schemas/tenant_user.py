from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


class InviteRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=200)
    role: str = Field(default="staff", pattern=r"^(admin|staff)$")
    password: str = Field(..., min_length=8, max_length=128)


class UpdateMemberRequest(BaseModel):
    role: str | None = Field(default=None, pattern=r"^(admin|staff)$")
    is_active: bool | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=200)


class MemberOut(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


class MemberList(BaseModel):
    items: list[MemberOut]
    total: int


class UpdateProfileRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=128)


class UpdateWorkspaceRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)


class WorkspaceOut(BaseModel):
    id: UUID
    slug: str
    name: str
    plan: str
    status: str
    created_at: datetime
