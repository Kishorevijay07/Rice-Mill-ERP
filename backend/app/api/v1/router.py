"""Aggregate router for API v1.

The product is invoice-only: RUKKU uses the app solely to generate and store GST
tax invoices. Only the auth, settings, documents and invoicing routers are wired.

The government/receiving/milling/rice/delivery/billing/reports modules remain in
the codebase (their models keep the DB schema intact) but their HTTP routers are
intentionally left unregistered. Re-add the corresponding ``include_router`` line
to switch a module's API back on.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.auth.router import router as auth_router
from app.modules.documents.router import router as documents_router
from app.modules.invoicing.public_router import router as public_invoicing_router
from app.modules.invoicing.router import router as invoicing_router
from app.modules.settings.router import router as settings_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth_router)
api_router.include_router(settings_router)
api_router.include_router(invoicing_router)
# Public (no-login) invoice access behind an unguessable token — QR landing page.
api_router.include_router(public_invoicing_router)
api_router.include_router(documents_router)
