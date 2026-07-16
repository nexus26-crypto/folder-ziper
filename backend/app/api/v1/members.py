from uuid import UUID
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DBSession, CurrentUser, CurrentTenant
from app.core.security import hash_password
from app.models.public import PlatformUser
from app.schemas.tenant_user import (
    InviteRequest, UpdateMemberRequest, MemberOut, MemberList,
)

router = APIRouter(prefix="/members", tags=["members"])


def _require_admin(user: PlatformUser):
    if user.role not in ("owner", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")


def _out(u: PlatformUser) -> MemberOut:
    return MemberOut(
        id=u.id, email=u.email, full_name=u.full_name, role=u.role,
        is_active=u.is_active, created_at=u.created_at,
    )


@router.get("", response_model=MemberList)
async def list_members(db: DBSession, tenant: CurrentTenant, user: CurrentUser):
    rows = (await db.execute(
        select(PlatformUser).where(PlatformUser.tenant_id == tenant.id).order_by(PlatformUser.created_at.desc())
    )).scalars().all()
    return MemberList(items=[_out(u) for u in rows], total=len(rows))


@router.post("", response_model=MemberOut, status_code=201)
async def invite_member(payload: InviteRequest, db: DBSession, tenant: CurrentTenant, user: CurrentUser):
    _require_admin(user)
    existing = (await db.execute(select(PlatformUser).where(PlatformUser.email == payload.email))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Email already registered")
    new = PlatformUser(
        tenant_id=tenant.id,
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
    )
    db.add(new)
    await db.commit()
    await db.refresh(new)
    return _out(new)


@router.patch("/{member_id}", response_model=MemberOut)
async def update_member(member_id: UUID, payload: UpdateMemberRequest, db: DBSession, tenant: CurrentTenant, user: CurrentUser):
    _require_admin(user)
    target = (await db.execute(
        select(PlatformUser).where(PlatformUser.id == member_id, PlatformUser.tenant_id == tenant.id)
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Member not found")
    if target.role == "owner":
        raise HTTPException(403, "Cannot modify owner")

    if payload.role is not None:
        target.role = payload.role
    if payload.is_active is not None:
        target.is_active = payload.is_active
    if payload.full_name is not None:
        target.full_name = payload.full_name
    await db.commit()
    await db.refresh(target)
    return _out(target)


@router.delete("/{member_id}", status_code=204)
async def remove_member(member_id: UUID, db: DBSession, tenant: CurrentTenant, user: CurrentUser):
    _require_admin(user)
    target = (await db.execute(
        select(PlatformUser).where(PlatformUser.id == member_id, PlatformUser.tenant_id == tenant.id)
    )).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "Member not found")
    if target.role == "owner":
        raise HTTPException(403, "Cannot remove owner")
    if target.id == user.id:
        raise HTTPException(403, "Cannot remove yourself")
    await db.delete(target)
    await db.commit()
