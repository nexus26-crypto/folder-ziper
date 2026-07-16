from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DBSession, CurrentUser
from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.tenant import create_tenant_schema, generate_schema_name
from app.core.database import engine
from app.models.public import Tenant, PlatformUser
from app.schemas.auth import (
    SignupRequest,
    LoginRequest,
    RefreshRequest,
    TokenPair,
    UserOut,
    AuthResponse,
)


router = APIRouter(prefix="/auth", tags=["auth"])


def _user_out(user: PlatformUser, tenant: Tenant | None) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        tenant_id=user.tenant_id,
        tenant_slug=tenant.slug if tenant else None,
        tenant_name=tenant.name if tenant else None,
        created_at=user.created_at,
    )


def _issue_tokens(user: PlatformUser) -> TokenPair:
    tid = str(user.tenant_id) if user.tenant_id else None
    return TokenPair(
        access_token=create_access_token(str(user.id), tid, {"role": user.role}),
        refresh_token=create_refresh_token(str(user.id), tid),
    )


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest, db: DBSession) -> AuthResponse:
    # slug único?
    existing = await db.execute(select(Tenant).where(Tenant.slug == payload.tenant_slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Tenant slug already taken")

    # email único?
    existing_email = await db.execute(select(PlatformUser).where(PlatformUser.email == payload.email))
    if existing_email.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    # cria tenant + schema
    schema_name = generate_schema_name()
    tenant = Tenant(
        slug=payload.tenant_slug,
        name=payload.tenant_name,
        schema_name=schema_name,
        plan="trial",
        status="active",
    )
    db.add(tenant)
    await db.flush()

    user = PlatformUser(
        tenant_id=tenant.id,
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role="owner",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await db.refresh(tenant)

    # cria schema físico
    async with engine.begin() as conn:
        await create_tenant_schema(conn, schema_name)

    return AuthResponse(user=_user_out(user, tenant), tokens=_issue_tokens(user))


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db: DBSession) -> AuthResponse:
    result = await db.execute(select(PlatformUser).where(PlatformUser.email == payload.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "User inactive")

    tenant = None
    if user.tenant_id:
        t = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
        tenant = t.scalar_one_or_none()

    return AuthResponse(user=_user_out(user, tenant), tokens=_issue_tokens(user))


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: DBSession) -> TokenPair:
    try:
        data = decode_token(payload.refresh_token)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if data.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token type")

    result = await db.execute(select(PlatformUser).where(PlatformUser.id == data["sub"]))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
    return _issue_tokens(user)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser, db: DBSession) -> UserOut:
    tenant = None
    if user.tenant_id:
        t = await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
        tenant = t.scalar_one_or_none()
    return _user_out(user, tenant)
