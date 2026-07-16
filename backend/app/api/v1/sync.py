from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text

from app.api.deps import DBSession, CurrentUser, CurrentTenant
from app.schemas.sync import (
    XtreamSourceCreate, XtreamSourceOut, SyncJobOut, SyncJobList, TriggerSyncRequest,
)

router = APIRouter(prefix="/sync", tags=["sync"])


def _source(r) -> XtreamSourceOut:
    return XtreamSourceOut(
        id=r.id, name=r.name, host=r.host, username=r.username, kind=r.kind,
        is_active=r.is_active, last_sync_at=r.last_sync_at, created_at=r.created_at,
    )


def _job(r) -> SyncJobOut:
    return SyncJobOut(
        id=r.id, job_type=r.job_type, source_id=r.source_id, status=r.status,
        progress=r.progress, payload=r.payload, result=r.result, error=r.error,
        started_at=r.started_at, finished_at=r.finished_at, created_at=r.created_at,
    )


@router.get("/sources", response_model=list[XtreamSourceOut])
async def list_sources(db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    rows = (await db.execute(text("SELECT * FROM xtream_sources ORDER BY created_at DESC"))).mappings().all()
    return [_source(r) for r in rows]


@router.post("/sources", response_model=XtreamSourceOut, status_code=201)
async def create_source(payload: XtreamSourceCreate, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    row = (await db.execute(text("""
        INSERT INTO xtream_sources (name, host, username, password, kind)
        VALUES (:name, :host, :username, :password, :kind) RETURNING *
    """), payload.model_dump())).mappings().one()
    await db.commit()
    return _source(row)


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(source_id: UUID, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    r = await db.execute(text("DELETE FROM xtream_sources WHERE id = :id"), {"id": source_id})
    if r.rowcount == 0:
        raise HTTPException(404, "Source not found")
    await db.commit()


@router.post("/trigger", response_model=SyncJobOut, status_code=202)
async def trigger_sync(
    payload: TriggerSyncRequest, db: DBSession, tenant: CurrentTenant, _u: CurrentUser,
):
    src = (await db.execute(
        text("SELECT * FROM xtream_sources WHERE id = :id"), {"id": payload.source_id}
    )).mappings().first()
    if not src:
        raise HTTPException(404, "Source not found")

    row = (await db.execute(text("""
        INSERT INTO sync_jobs (job_type, source_id, status, payload)
        VALUES ('xtream_sync', :sid, 'queued', :payload::jsonb)
        RETURNING *
    """), {"sid": str(payload.source_id), "payload": '{"kind":"' + src.kind + '"}'})).mappings().one()
    await db.commit()

    # Enfileira no Celery — a task real ainda é stub, mas o job já é rastreável.
    try:
        from app.workers.tasks_sync import sync_xtream_full
        sync_xtream_full.delay(
            tenant.schema_name,
            {"host": src.host, "username": src.username, "password": src.password, "kind": src.kind, "job_id": str(row.id)},
        )
    except Exception:
        pass  # broker offline não deve derrubar o request
    return _job(row)


@router.get("/jobs", response_model=SyncJobList)
async def list_jobs(
    db: DBSession, _t: CurrentTenant, _u: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
):
    where = ""
    params: dict = {"limit": limit}
    if status_filter:
        where = "WHERE status = :status"
        params["status"] = status_filter
    total = (await db.execute(text(f"SELECT count(*) FROM sync_jobs {where}"), params)).scalar_one()
    rows = (await db.execute(
        text(f"SELECT * FROM sync_jobs {where} ORDER BY created_at DESC LIMIT :limit"), params,
    )).mappings().all()
    return SyncJobList(items=[_job(r) for r in rows], total=total)
