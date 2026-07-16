from typing import Annotated, Any
from uuid import UUID
from datetime import datetime, timezone
import json
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from sqlalchemy import text

from app.api.deps import DBSession, CurrentUser, CurrentTenant
from app.schemas.sync import (
    XtreamSourceCreate, XtreamSourceUpdate, XtreamSourceOut,
    SyncJobOut, SyncJobList, TriggerSyncRequest,
)

router = APIRouter(prefix="/sync", tags=["sync"])


def _source(r) -> XtreamSourceOut:
    mapping = r.mapping
    if isinstance(mapping, str):
        try: mapping = json.loads(mapping)
        except Exception: mapping = None
    return XtreamSourceOut(
        id=r.id, name=r.name, source_type=r.source_type, host=r.host, username=r.username,
        kind=r.kind, m3u_url=r.m3u_url, xui_connection_id=r.xui_connection_id,
        mapping=mapping, auto_sync=r.auto_sync, auto_sync_cron=r.auto_sync_cron,
        is_active=r.is_active, last_sync_at=r.last_sync_at,
        last_auto_run_at=r.last_auto_run_at, created_at=r.created_at,
    )


def _job(r) -> SyncJobOut:
    result = r.result
    if isinstance(result, str):
        try: result = json.loads(result)
        except Exception: result = None
    payload = r.payload
    if isinstance(payload, str):
        try: payload = json.loads(payload)
        except Exception: payload = None
    return SyncJobOut(
        id=r.id, job_type=r.job_type, source_id=r.source_id, status=r.status,
        progress=r.progress, total_items=r.total_items or 0,
        inserted=r.inserted or 0, skipped=r.skipped or 0, errors=r.errors or 0,
        log_tail=r.log_tail, payload=payload, result=result, error=r.error,
        started_at=r.started_at, finished_at=r.finished_at, created_at=r.created_at,
    )


# --------------------- SOURCES ---------------------

@router.get("/sources", response_model=list[XtreamSourceOut])
async def list_sources(db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    rows = (await db.execute(text("SELECT * FROM xtream_sources ORDER BY created_at DESC"))).mappings().all()
    return [_source(r) for r in rows]


@router.post("/sources", response_model=XtreamSourceOut, status_code=201)
async def create_source(payload: XtreamSourceCreate, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    data = payload.model_dump()
    data["mapping"] = json.dumps(data.get("mapping") or {})
    row = (await db.execute(text("""
        INSERT INTO xtream_sources
            (name, source_type, host, username, password, kind, m3u_url, m3u_content,
             xui_connection_id, mapping, auto_sync, auto_sync_cron)
        VALUES
            (:name,:source_type,:host,:username,:password,:kind,:m3u_url,:m3u_content,
             :xui_connection_id,CAST(:mapping AS jsonb),:auto_sync,:auto_sync_cron)
        RETURNING *
    """), data)).mappings().one()
    await db.commit()
    return _source(row)


@router.patch("/sources/{source_id}", response_model=XtreamSourceOut)
async def update_source(source_id: UUID, payload: XtreamSourceUpdate, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    fields = payload.model_dump(exclude_unset=True)
    if "mapping" in fields:
        fields["mapping"] = json.dumps(fields["mapping"] or {})
    if not fields:
        raise HTTPException(400, "nothing to update")
    sets = []
    for k in fields:
        if k == "mapping":
            sets.append("mapping = CAST(:mapping AS jsonb)")
        else:
            sets.append(f"{k} = :{k}")
    fields["id"] = source_id
    row = (await db.execute(text(f"UPDATE xtream_sources SET {', '.join(sets)} WHERE id = :id RETURNING *"), fields)).mappings().first()
    if not row: raise HTTPException(404, "source not found")
    await db.commit()
    return _source(row)


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(source_id: UUID, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    r = await db.execute(text("DELETE FROM xtream_sources WHERE id = :id"), {"id": source_id})
    if r.rowcount == 0: raise HTTPException(404, "source not found")
    await db.commit()


@router.post("/sources/upload-m3u", response_model=XtreamSourceOut, status_code=201)
async def upload_m3u(
    db: DBSession, _t: CurrentTenant, _u: CurrentUser,
    name: Annotated[str, Form(...)],
    file: Annotated[UploadFile, File(...)],
    xui_connection_id: Annotated[str | None, Form()] = None,
):
    raw = (await file.read()).decode("utf-8", errors="ignore")
    row = (await db.execute(text("""
        INSERT INTO xtream_sources (name, source_type, m3u_content, xui_connection_id, mapping)
        VALUES (:name,'m3u_file',:content,:xui,CAST('{}' AS jsonb))
        RETURNING *
    """), {"name": name, "content": raw, "xui": xui_connection_id})).mappings().one()
    await db.commit()
    return _source(row)


# --------------------- TRIGGER / JOBS ---------------------

@router.post("/trigger", response_model=SyncJobOut, status_code=202)
async def trigger_sync(payload: TriggerSyncRequest, db: DBSession, tenant: CurrentTenant, _u: CurrentUser):
    src = (await db.execute(
        text("SELECT * FROM xtream_sources WHERE id = :id"), {"id": payload.source_id}
    )).mappings().first()
    if not src: raise HTTPException(404, "source not found")

    row = (await db.execute(text("""
        INSERT INTO sync_jobs (job_type, source_id, status)
        VALUES ('source_sync', :sid, 'queued')
        RETURNING *
    """), {"sid": str(payload.source_id)})).mappings().one()
    await db.commit()

    try:
        from app.workers.tasks_sync import run_source_sync
        run_source_sync.delay(tenant.schema_name, str(row.id), str(payload.source_id))
    except Exception as e:
        await db.execute(text("UPDATE sync_jobs SET status='failed', error=:e WHERE id=:id"),
                         {"e": f"broker offline: {e}", "id": row.id})
        await db.commit()
    return _job(row)


@router.get("/jobs", response_model=SyncJobList)
async def list_jobs(
    db: DBSession, _t: CurrentTenant, _u: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    status_filter: Annotated[str | None, Query(alias="status")] = None,
):
    where = ""
    params: dict[str, Any] = {"limit": limit}
    if status_filter:
        where = "WHERE status = :status"
        params["status"] = status_filter
    total = (await db.execute(text(f"SELECT count(*) FROM sync_jobs {where}"), params)).scalar_one()
    rows = (await db.execute(
        text(f"SELECT * FROM sync_jobs {where} ORDER BY created_at DESC LIMIT :limit"), params,
    )).mappings().all()
    return SyncJobList(items=[_job(r) for r in rows], total=total)


@router.get("/jobs/{job_id}", response_model=SyncJobOut)
async def get_job(job_id: UUID, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    row = (await db.execute(text("SELECT * FROM sync_jobs WHERE id = :id"), {"id": job_id})).mappings().first()
    if not row: raise HTTPException(404, "job not found")
    return _job(row)


@router.get("/jobs/{job_id}/log")
async def get_job_log(job_id: UUID, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    row = (await db.execute(text("SELECT log_tail, status, progress FROM sync_jobs WHERE id = :id"), {"id": job_id})).mappings().first()
    if not row: raise HTTPException(404, "job not found")
    return {"log": row.log_tail or "", "status": row.status, "progress": row.progress}
