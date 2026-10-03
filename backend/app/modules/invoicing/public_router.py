"""Public (no-login) invoice access for the QR-code landing page.

These endpoints are secured only by an unguessable per-invoice ``public_token``
printed as a QR on the PDF, so a buyer can scan it on a phone (which carries no
session cookie) and download the same invoice. Kept in a dedicated router with no
auth dependency so authentication is never accidentally inherited.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.invoicing import service
from app.modules.invoicing.schemas import PublicInvoiceSummary
from app.modules.settings.service import get_or_create_mill_settings

router = APIRouter(prefix="/public/invoices", tags=["public-invoicing"])


@router.get("/{token}", response_model=PublicInvoiceSummary)
def public_invoice_summary(token: str, db: Session = Depends(get_db)) -> PublicInvoiceSummary:
    invoice = service.get_invoice_by_token(db, token)
    mill = get_or_create_mill_settings(db)
    return PublicInvoiceSummary(
        invoice_number=invoice.invoice_number,
        invoice_date=invoice.invoice_date,
        seller_name=mill.name,
        buyer_name=invoice.buyer_name,
        grand_total=invoice.grand_total,
        currency=invoice.currency,
        status=invoice.status,
    )


@router.get("/{token}/pdf")
def public_invoice_pdf(token: str, db: Session = Depends(get_db)) -> Response:
    filename, data = service.render_public_pdf_bytes(db, token)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
