from fastapi import APIRouter

from app.api.v1 import auth, channels, sync, banners, members, settings, xui

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(channels.router)
api_router.include_router(sync.router)
api_router.include_router(banners.router)
api_router.include_router(members.router)
api_router.include_router(settings.router)
api_router.include_router(xui.router)
