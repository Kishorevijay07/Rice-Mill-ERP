"""Invoicing HTTP endpoints: buyers, products, and GST tax invoices."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.dependencies import actor_from_request as _actor
from app.modules.auth.dependencies import require_permission
from app.modules.auth.models import User
from app.modules.auth.permissions import Permission
from app.modules.documents import service as documents_service
from app.modules.invoicing import service
from app.modules.invoicing.models import TaxInvoice, TaxInvoiceLine
from app.modules.invoicing.pdf import TaxSummaryLine
from app.modules.invoicing.schemas import (
    BuyerCreate,
    BuyerOut,
    DocumentResponse,
    InvoiceCreate,
    InvoiceDetail,
    InvoiceLineOut,
    InvoiceOut,
    InvoiceUpdate,
    ProductCreate,
    ProductOut,
    TaxSummaryRow,
)
from app.modules.settings.service import get_or_create_mill_settings
from app.shared.http import Pagination
from app.shared.numbers import gst_components, is_interstate
from app.shared.schemas import Page

router = APIRouter(tags=["invoicing"])


# --------------------------------------------------------------------------- #
# Buyers
# --------------------------------------------------------------------------- #
@router.get("/buyers", response_model=list[BuyerOut])
def list_buyers(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(Permission.INVOICE_VIEW)),
) -> list[BuyerOut]:
    return [BuyerOut.model_validate(b) for b in service.list_buyers(db, active_only=active_only)]


@router.post("/buyers", response_model=BuyerOut, status_code=status.HTTP_201_CREATED)
def create_buyer(
    payload: BuyerCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_MASTERS_MANAGE)),
) -> BuyerOut:
    return BuyerOut.model_validate(service.create_buyer(db, payload, _actor(request, user)))


@router.get("/buyers/{buyer_id}", response_model=BuyerOut)
def get_buyer(
    buyer_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(Permission.INVOICE_VIEW)),
) -> BuyerOut:
    return BuyerOut.model_validate(service.get_buyer(db, buyer_id))


@router.put("/buyers/{buyer_id}", response_model=BuyerOut)
def update_buyer(
    buyer_id: uuid.UUID,
    payload: BuyerCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_MASTERS_MANAGE)),
) -> BuyerOut:
    return BuyerOut.model_validate(
        service.update_buyer(db, buyer_id, payload, _actor(request, user))
    )


@router.delete("/buyers/{buyer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_buyer(
    buyer_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_MASTERS_MANAGE)),
) -> Response:
    service.delete_buyer(db, buyer_id, _actor(request, user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------- #
# Products
# --------------------------------------------------------------------------- #
@router.get("/products", response_model=list[ProductOut])
def list_products(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(Permission.INVOICE_VIEW)),
) -> list[ProductOut]:
    return [
        ProductOut.model_validate(p) for p in service.list_products(db, active_only=active_only)
    ]


@router.post("/products", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_MASTERS_MANAGE)),
) -> ProductOut:
    return ProductOut.model_validate(service.create_product(db, payload, _actor(request, user)))


@router.get("/products/{product_id}", response_model=ProductOut)
def get_product(
    product_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(Permission.INVOICE_VIEW)),
) -> ProductOut:
    return ProductOut.model_validate(service.get_product(db, product_id))


@router.put("/products/{product_id}", response_model=ProductOut)
def update_product(
    product_id: uuid.UUID,
    payload: ProductCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_MASTERS_MANAGE)),
) -> ProductOut:
    updated = service.update_product(db, product_id, payload, _actor(request, user))
    return ProductOut.model_validate(updated)


# --------------------------------------------------------------------------- #
# Tax invoices
# --------------------------------------------------------------------------- #
def _line_out(line: TaxInvoiceLine, interstate: bool) -> InvoiceLineOut:
    c = gst_components(line.gst_rate, line.gst_amount, interstate=interstate)
    return InvoiceLineOut(
        id=line.id,
        product_id=line.product_id,
        description=line.description,
        bags=line.bags,
        hsn_sac=line.hsn_sac,
        quantity=line.quantity,
        uom=line.uom,
        rate=line.rate,
        taxable_amount=line.taxable_amount,
        gst_rate=line.gst_rate,
        gst_amount=line.gst_amount,
        cgst_rate=c.cgst_rate,
        cgst_amount=c.cgst_amount,
        sgst_rate=c.sgst_rate,
        sgst_amount=c.sgst_amount,
        igst_rate=c.igst_rate,
        igst_amount=c.igst_amount,
        sort_order=line.sort_order,
    )


def _tax_summary_row(row: TaxSummaryLine, interstate: bool) -> TaxSummaryRow:
    c = gst_components(row.gst_rate, row.gst_amount, interstate=interstate)
    return TaxSummaryRow(
        hsn_sac=row.hsn_sac,
        taxable_amount=row.taxable_amount,
        gst_rate=row.gst_rate,
        gst_amount=row.gst_amount,
        cgst_rate=c.cgst_rate,
        cgst_amount=c.cgst_amount,
        sgst_rate=c.sgst_rate,
        sgst_amount=c.sgst_amount,
        igst_rate=c.igst_rate,
        igst_amount=c.igst_amount,
    )


def _detail(db: Session, invoice: TaxInvoice) -> InvoiceDetail:
    mill = get_or_create_mill_settings(db)
    interstate = is_interstate(mill.state_code, invoice.buyer_state_code)
    return InvoiceDetail(
        **InvoiceOut.model_validate(invoice).model_dump(),
        delivery_note=invoice.delivery_note,
        mode_terms_of_payment=invoice.mode_terms_of_payment,
        reference_no_date=invoice.reference_no_date,
        other_references=invoice.other_references,
        buyers_order_no=invoice.buyers_order_no,
        buyers_order_dated=invoice.buyers_order_dated,
        dispatch_doc_no=invoice.dispatch_doc_no,
        delivery_note_date=invoice.delivery_note_date,
        dispatched_through=invoice.dispatched_through,
        bill_of_lading_lr_rr_no=invoice.bill_of_lading_lr_rr_no,
        terms_of_delivery=invoice.terms_of_delivery,
        declaration=invoice.declaration,
        public_token=invoice.public_token,
        is_interstate=interstate,
        lines=[
            _line_out(ln, interstate) for ln in sorted(invoice.lines, key=lambda x: x.sort_order)
        ],
        tax_summary=[_tax_summary_row(row, interstate) for row in service.tax_summary(invoice)],
        amount_in_words=service.amount_words(invoice),
        tax_amount_in_words=service.tax_words(invoice),
    )


@router.post("/tax-invoices", response_model=InvoiceDetail, status_code=status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_CREATE)),
) -> InvoiceDetail:
    return _detail(db, service.create_invoice(db, payload, _actor(request, user)))


@router.get("/tax-invoices", response_model=Page[InvoiceOut])
def list_invoices(
    pagination: Pagination = Depends(),
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(Permission.INVOICE_VIEW)),
) -> Page[InvoiceOut]:
    rows, total = service.list_invoices(db, pagination.page, pagination.page_size)
    return Page[InvoiceOut](
        items=[InvoiceOut.model_validate(r) for r in rows],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get("/tax-invoices/{invoice_id}", response_model=InvoiceDetail)
def get_invoice(
    invoice_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(Permission.INVOICE_VIEW)),
) -> InvoiceDetail:
    return _detail(db, service.get_invoice(db, invoice_id))


@router.put("/tax-invoices/{invoice_id}", response_model=InvoiceDetail)
def update_invoice(
    invoice_id: uuid.UUID,
    payload: InvoiceUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_CREATE)),
) -> InvoiceDetail:
    return _detail(db, service.update_invoice(db, invoice_id, payload, _actor(request, user)))


@router.post("/tax-invoices/{invoice_id}/issue", response_model=InvoiceDetail)
def issue_invoice(
    invoice_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_ISSUE)),
) -> InvoiceDetail:
    return _detail(db, service.issue_invoice(db, invoice_id, _actor(request, user)))


@router.post("/tax-invoices/{invoice_id}/pdf", response_model=DocumentResponse)
def generate_invoice_pdf(
    invoice_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_CREATE)),
) -> DocumentResponse:
    document = service.generate_pdf(db, invoice_id, _actor(request, user))
    return DocumentResponse(document_id=document.id, filename=document.filename)


@router.get("/tax-invoices/{invoice_id}/pdf/download")
def download_invoice_pdf(
    invoice_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_permission(Permission.INVOICE_VIEW)),
) -> Response:
    invoice = service.get_invoice(db, invoice_id)
    data: bytes | None = None
    filename = f"tax-invoice-{invoice.invoice_number}.pdf"
    if invoice.pdf_document_id is not None:
        try:
            document = documents_service.get_document(db, invoice.pdf_document_id)
            data = documents_service.read_document_bytes(document)
            filename = document.filename
        except Exception:
            # Stored file unavailable (e.g. ephemeral disk wiped on redeploy) —
            # re-render on the fly. The invoice is immutable once issued.
            data = None
    if data is None:
        filename, data = service.render_pdf_bytes(db, invoice_id)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/tax-invoices/{invoice_id}/eway-bill", response_model=DocumentResponse)
def upload_eway_bill(
    invoice_id: uuid.UUID,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.INVOICE_CREATE)),
) -> DocumentResponse:
    data = file.file.read()
    document = service.attach_eway_bill(
        db,
        invoice_id,
        filename=file.filename or "eway-bill.pdf",
        content_type=file.content_type or "application/pdf",
        data=data,
        actor=_actor(request, user),
    )
    return DocumentResponse(document_id=document.id, filename=document.filename)
