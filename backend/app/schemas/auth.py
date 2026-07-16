from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
from uuid import UUID


class SignupRequest(BaseModel):
    """Cria um novo tenant + primeiro usuário owner (self-service)."""
    tenant_name: str = Field(..., min_length=2, max_length=200)
    tenant_slug: str = Field(..., min_length=3, max_length=32, pattern=r"^[a-z0-9-]+$")
    full_name: str = Field(..., min_length=2, max_length=200)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: UUID
    email: str
    full_name: str
    role: str
    tenant_id: UUID | None
    tenant_slug: str | None = None
    tenant_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    user: UserOut
    tokens: TokenPair
