from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.api.deps import DBSession, CurrentUser, CurrentTenant
from app.core.crypto import encrypt, decrypt
from app.schemas.xui import (
    XuiConnectionCreate, XuiConnectionUpdate, XuiConnectionOut, XuiTestResult,
)
from app.services.xtream import xui_db

router = APIRouter(prefix="/xui-connections", tags=["panels"])


def _out(r) -> XuiConnectionOut:
    return XuiConnectionOut(
        id=r.id, name=r.name, panel_type=r.panel_type or "auto",
        host=r.host, port=r.port, db_name=r.db_name,
        db_user=r.db_user, is_default=r.is_default,
        last_test_at=r.last_test_at, last_test_ok=r.last_test_ok,
        last_test_error=r.last_test_error, detected_version=r.detected_version,
        created_at=r.created_at,
    )


def _cfg(row) -> dict:
    return {"host": row.host, "port": row.port, "db_name": row.db_name,
            "db_user": row.db_user, "db_pass": decrypt(row.db_pass_enc),
            "panel_type": row.panel_type or "auto"}


@router.get("", response_model=list[XuiConnectionOut])
async def list_conns(db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    rows = (await db.execute(text('SELECT * FROM xui_connections ORDER BY is_default DESC, created_at DESC'))).mappings().all()
    return [_out(r) for r in rows]


@router.post("", response_model=XuiConnectionOut, status_code=201)
async def create_conn(payload: XuiConnectionCreate, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    if payload.is_default:
        await db.execute(text("UPDATE xui_connections SET is_default = false"))
    row = (await db.execute(text("""
        INSERT INTO xui_connections (name, panel_type, host, port, db_name, db_user, db_pass_enc, is_default)
        VALUES (:name,:panel_type,:host,:port,:db_name,:db_user,:db_pass_enc,:is_default)
        RETURNING *
    """), {
        "name": payload.name, "panel_type": payload.panel_type,
        "host": payload.host, "port": payload.port,
        "db_name": payload.db_name, "db_user": payload.db_user,
        "db_pass_enc": encrypt(payload.db_pass), "is_default": payload.is_default,
    })).mappings().one()
    await db.commit()
    return _out(row)


@router.patch("/{conn_id}", response_model=XuiConnectionOut)
async def update_conn(conn_id: UUID, payload: XuiConnectionUpdate, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    fields = payload.model_dump(exclude_unset=True)
    if "db_pass" in fields:
        fields["db_pass_enc"] = encrypt(fields.pop("db_pass"))
    if fields.get("is_default"):
        await db.execute(text("UPDATE xui_connections SET is_default = false"))
    if not fields:
        raise HTTPException(400, "nothing to update")
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    fields["id"] = conn_id
    row = (await db.execute(text(f"UPDATE xui_connections SET {sets} WHERE id = :id RETURNING *"), fields)).mappings().first()
    if not row: raise HTTPException(404, "not found")
    await db.commit()
    return _out(row)


@router.delete("/{conn_id}", status_code=204)
async def delete_conn(conn_id: UUID, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    r = await db.execute(text("DELETE FROM xui_connections WHERE id = :id"), {"id": conn_id})
    if r.rowcount == 0: raise HTTPException(404, "not found")
    await db.commit()


@router.post("/{conn_id}/test", response_model=XuiTestResult)
async def test_conn(conn_id: UUID, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    row = (await db.execute(text("SELECT * FROM xui_connections WHERE id = :id"), {"id": conn_id})).mappings().first()
    if not row: raise HTTPException(404, "not found")
    result = xui_db.test_connection(_cfg(row))
    await db.execute(text("""
        UPDATE xui_connections SET last_test_at = :ts, last_test_ok = :ok,
               last_test_error = :err, detected_version = :ver
        WHERE id = :id
    """), {
        "ts": datetime.now(timezone.utc), "ok": result["ok"],
        "err": result.get("error"), "ver": result.get("version"),
        "id": conn_id,
    })
    await db.commit()
    return XuiTestResult(**result)


@router.get("/{conn_id}/meta")
async def get_meta(conn_id: UUID, db: DBSession, _t: CurrentTenant, _u: CurrentUser):
    """Retorna bouquets/servers/categorias — usado pra tela de mapeamento."""
    row = (await db.execute(text("SELECT * FROM xui_connections WHERE id = :id"), {"id": conn_id})).mappings().first()
    if not row: raise HTTPException(404, "not found")
    result = xui_db.test_connection(_cfg(row))
    if not result["ok"]:
        raise HTTPException(502, result.get("error") or "connection failed")
    return result
