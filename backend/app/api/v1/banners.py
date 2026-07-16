from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from app.api.deps import DBSession, CurrentUser, CurrentTenant
from app.schemas.banner import BannerCreate, BannerOut, BannerList

router = APIRouter(prefix="/banners", tags=["banners"])


def _row(r) -> BannerOut:
    return BannerOut(
        id=r.id, title=r.title, subtitle=r.subtitle, theme=r.theme,
        template=r.template, logo_url=r.logo_url, image_url=r.image_url,
        status=r.status, created_at=r.created_at,
    )


@router.get("", response_model=BannerList)
async def list_banners(
    db: DBSession, _t: CurrentTenant, _u: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    total = (await db.execute(text("SELECT count(*) FROM banners"))).scalar_one()
    rows = (await db.execute(
        text("SELECT * FROM banners ORDER BY created_at DESC LIMIT :limit"), {"limit": limit},
    )).mappings().all()
    return BannerList(items=[_row(r) for r in rows], total=total)


@router.post("", response_model=BannerOut, status_code=201)
async def create_banner(
    payload: BannerCreate, db: DBSession, tenant: CurrentTenant, _u: CurrentUser,
):
    row = (await db.execute(text("""
        INSERT INTO banners (title, subtitle, theme, template, logo_url, status)
        VALUES (:title, :subtitle, :theme, :template, :logo_url, 'pending')
        RETURNING *
    """), payload.model_dump())).mappings().one()
    await db.commit()

    try:
        from app.workers.tasks_banner import gerar_banner
        gerar_banner.delay(tenant.schema_name, str(row.id), payload.model_dump())
    except Exception:
        pass
    return _row(row)


@router.delete("/{banner_id}", status_code=204)
async def delete_banner(banner_id: UUID, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    r = await db.execute(text("DELETE FROM banners WHERE id = :id"), {"id": banner_id})
    if r.rowcount == 0:
        raise HTTPException(404, "Banner not found")
    await db.commit()
