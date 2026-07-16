from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DBSession, CurrentUser, CurrentTenant
from app.core.security import hash_password, verify_password
from app.models.public import Tenant
from app.schemas.tenant_user import (
    UpdateProfileRequest, UpdateWorkspaceRequest, WorkspaceOut,
)
from app.schemas.auth import UserOut

router = APIRouter(prefix="/settings", tags=["settings"])


@router.patch("/profile", response_model=UserOut)
async def update_profile(payload: UpdateProfileRequest, db: DBSession, tenant: CurrentTenant, user: CurrentUser):
    if payload.full_name:
        user.full_name = payload.full_name
    if payload.new_password:
        if not payload.current_password or not verify_password(payload.current_password, user.password_hash):
            raise HTTPException(400, "Senha atual incorreta")
        user.password_hash = hash_password(payload.new_password)
    await db.commit()
    await db.refresh(user)
    return UserOut(
        id=user.id, email=user.email, full_name=user.full_name, role=user.role,
        tenant_id=user.tenant_id, tenant_slug=tenant.slug, tenant_name=tenant.name,
        created_at=user.created_at,
    )


@router.get("/workspace", response_model=WorkspaceOut)
async def get_workspace(_db: DBSession, tenant: CurrentTenant, _u: CurrentUser):
    return WorkspaceOut(
        id=tenant.id, slug=tenant.slug, name=tenant.name,
        plan=tenant.plan, status=tenant.status, created_at=tenant.created_at,
    )


@router.patch("/workspace", response_model=WorkspaceOut)
async def update_workspace(payload: UpdateWorkspaceRequest, db: DBSession, tenant: CurrentTenant, user: CurrentUser):
    if user.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owner can update workspace")
    tenant.name = payload.name
    await db.commit()
    await db.refresh(tenant)
    return WorkspaceOut(
        id=tenant.id, slug=tenant.slug, name=tenant.name,
        plan=tenant.plan, status=tenant.status, created_at=tenant.created_at,
    )
