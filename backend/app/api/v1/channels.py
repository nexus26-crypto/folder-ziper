from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text, bindparam

from app.api.deps import DBSession, CurrentUser, CurrentTenant
from app.schemas.channel import (
    ChannelCreate, ChannelUpdate, ChannelOut, ChannelList, BulkAction,
)

router = APIRouter(prefix="/channels", tags=["channels"])


def _row_to_channel(r) -> ChannelOut:
    return ChannelOut(
        id=r.id, name=r.name, category=r.category, group_name=r.group_name,
        logo_url=r.logo_url, stream_url=r.stream_url, epg_id=r.epg_id,
        is_active=r.is_active, created_at=r.created_at, updated_at=r.updated_at,
    )


@router.get("", response_model=ChannelList)
async def list_channels(
    db: DBSession, _tenant: CurrentTenant, _user: CurrentUser,
    q: Annotated[str | None, Query()] = None,
    category: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ChannelList:
    where = []
    params: dict = {"limit": limit, "offset": offset}
    if q:
        where.append("name ILIKE :q")
        params["q"] = f"%{q}%"
    if category:
        where.append("category = :category")
        params["category"] = category
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = (await db.execute(text(f"SELECT count(*) FROM channels {where_sql}"), params)).scalar_one()
    rows = (await db.execute(
        text(f"SELECT * FROM channels {where_sql} ORDER BY created_at DESC LIMIT :limit OFFSET :offset"),
        params,
    )).mappings().all()
    return ChannelList(items=[_row_to_channel(r) for r in rows], total=total)


@router.post("", response_model=ChannelOut, status_code=status.HTTP_201_CREATED)
async def create_channel(
    payload: ChannelCreate, db: DBSession, _tenant: CurrentTenant, _user: CurrentUser,
) -> ChannelOut:
    row = (await db.execute(text("""
        INSERT INTO channels (name, category, group_name, logo_url, stream_url, epg_id, is_active)
        VALUES (:name, :category, :group_name, :logo_url, :stream_url, :epg_id, :is_active)
        RETURNING *
    """), payload.model_dump())).mappings().one()
    await db.commit()
    return _row_to_channel(row)


@router.patch("/{channel_id}", response_model=ChannelOut)
async def update_channel(
    channel_id: UUID, payload: ChannelUpdate,
    db: DBSession, _tenant: CurrentTenant, _user: CurrentUser,
) -> ChannelOut:
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(400, "No fields to update")
    sets = ", ".join(f"{k} = :{k}" for k in data)
    data["id"] = channel_id
    row = (await db.execute(
        text(f"UPDATE channels SET {sets}, updated_at = now() WHERE id = :id RETURNING *"),
        data,
    )).mappings().first()
    if not row:
        raise HTTPException(404, "Channel not found")
    await db.commit()
    return _row_to_channel(row)


@router.delete("/{channel_id}", status_code=204)
async def delete_channel(
    channel_id: UUID, db: DBSession, _tenant: CurrentTenant, _user: CurrentUser,
):
    r = await db.execute(text("DELETE FROM channels WHERE id = :id"), {"id": channel_id})
    if r.rowcount == 0:
        raise HTTPException(404, "Channel not found")
    await db.commit()


@router.post("/bulk", status_code=204)
async def bulk_channels(
    payload: BulkAction, db: DBSession, _tenant: CurrentTenant, _user: CurrentUser,
):
    if not payload.ids:
        return
    ids = [str(i) for i in payload.ids]
    stmt = {
        "activate": text("UPDATE channels SET is_active = true, updated_at = now() WHERE id = ANY(:ids)"),
        "deactivate": text("UPDATE channels SET is_active = false, updated_at = now() WHERE id = ANY(:ids)"),
        "delete": text("DELETE FROM channels WHERE id = ANY(:ids)"),
    }[payload.action]
    await db.execute(stmt.bindparams(bindparam("ids", expanding=False)), {"ids": ids})
    await db.commit()
