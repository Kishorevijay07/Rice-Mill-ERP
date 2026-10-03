"""Invoicing domain logic: buyer/product masters and GST tax invoices.

Rules:
- Totals (taxable, tax, grand total) are always computed server-side from the
  lines; money is Decimal quantized to 2 places — never float (rule 7).
- Buyer details are snapshotted onto the invoice at creation.
- A DRAFT invoice may be edited; ISSUED is locked and its PDF is generated.
- Every mutation stamps the actor, writes an audit entry and commits atomically.
"""

from __future__ import annotations

import uuid
from collections import OrderedDict
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.modules.documents.models import Document
from app.modules.documents.service import (
    get_document,
    read_document_bytes,
    store_document,
)
from app.modules.invoicing.models import (
    Buyer,
    InvoiceStatus,
    Product,
    TaxInvoice,
    TaxInvoiceLine,
)
from app.modules.invoicing.pdf import (
    DEFAULT_COPIES,
    TaxInvoiceContext,
    TaxSummaryLine,
    render_tax_invoice,
)
from app.modules.invoicing.schemas import (
    BuyerCreate,
    InvoiceCreate,
    InvoiceLineInput,
    InvoiceUpdate,
    ProductCreate,
)
from app.modules.settings.service import get_or_create_mill_settings
from app.shared.audit import record_audit
from app.shared.context import ActorContext
from app.shared.errors import ConflictError, DomainError, InvalidStateError, NotFoundError
from app.shared.numbers import indian_amount_in_words
from app.shared.reference import ReferencePrefix, generate_reference

_INVOICE_ENTITY = "tax_invoice"
_CENTS = Decimal("0.01")
_HUNDRED = Decimal("100")


def _now() -> datetime:
    return datetime.now(UTC)


def _money(value: Decimal) -> Decimal:
    return value.quantize(_CENTS, rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------- #
# Buyer master
# --------------------------------------------------------------------------- #
def list_buyers(db: Session, active_only: bool = False) -> list[Buyer]:
    stmt = select(Buyer).order_by(Buyer.name)
    if active_only:
        stmt = stmt.where(Buyer.is_active.is_(True))
    return list(db.execute(stmt).scalars())


def get_buyer(db: Session, buyer_id: uuid.UUID) -> Buyer:
    buyer = db.get(Buyer, buyer_id)
    if buyer is None:
        raise NotFoundError("Buyer not found")
    return buyer


def create_buyer(db: Session, data: BuyerCreate, actor: ActorContext) -> Buyer:
    buyer = Buyer(
        name=data.name,
        address=data.address,
        gstin=data.gstin,
        state_name=data.state_name,
        state_code=data.state_code,
        cell=data.cell,
        is_active=data.is_active,
        created_by=actor.user_id,
        updated_by=actor.user_id,
    )
    db.add(buyer)
    record_audit(
        db,
        action="buyer.create",
        entity_type="buyer",
        entity_id=None,
        entity_reference=data.name,
        user_id=actor.user_id,
        after_data={"name": data.name, "gstin": data.gstin},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    db.refresh(buyer)
    return buyer


def update_buyer(db: Session, buyer_id: uuid.UUID, data: BuyerCreate, actor: ActorContext) -> Buyer:
    buyer = get_buyer(db, buyer_id)
    buyer.name = data.name
    buyer.address = data.address
    buyer.gstin = data.gstin
    buyer.state_name = data.state_name
    buyer.state_code = data.state_code
    buyer.cell = data.cell
    buyer.is_active = data.is_active
    buyer.updated_by = actor.user_id
    record_audit(
        db,
        action="buyer.update",
        entity_type="buyer",
        entity_id=buyer.id,
        entity_reference=buyer.name,
        user_id=actor.user_id,
        after_data={"name": buyer.name},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    db.refresh(buyer)
    return buyer


def delete_buyer(db: Session, buyer_id: uuid.UUID, actor: ActorContext) -> None:
    """Delete a buyer master. Existing invoices keep their snapshotted buyer
    details, so past invoices/PDFs are unaffected; we only detach the FK link."""
    buyer = get_buyer(db, buyer_id)
    db.execute(update(TaxInvoice).where(TaxInvoice.buyer_id == buyer_id).values(buyer_id=None))
    record_audit(
        db,
        action="buyer.delete",
        entity_type="buyer",
        entity_id=buyer.id,
        entity_reference=buyer.name,
        user_id=actor.user_id,
        before_data={"name": buyer.name, "gstin": buyer.gstin},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.delete(buyer)
    db.commit()


# --------------------------------------------------------------------------- #
# Product master
# --------------------------------------------------------------------------- #
def list_products(db: Session, active_only: bool = False) -> list[Product]:
    stmt = select(Product).order_by(Product.name)
    if active_only:
        stmt = stmt.where(Product.is_active.is_(True))
    return list(db.execute(stmt).scalars())


def get_product(db: Session, product_id: uuid.UUID) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise NotFoundError("Product not found")
    return product


def create_product(db: Session, data: ProductCreate, actor: ActorContext) -> Product:
    product = Product(
        name=data.name,
        hsn_sac=data.hsn_sac,
        default_gst_rate=data.default_gst_rate,
        default_uom=data.default_uom,
        default_rate=data.default_rate,
        is_active=data.is_active,
        created_by=actor.user_id,
        updated_by=actor.user_id,
    )
    db.add(product)
    record_audit(
        db,
        action="product.create",
        entity_type="product",
        entity_id=None,
        entity_reference=data.name,
        user_id=actor.user_id,
        after_data={"name": data.name, "hsn_sac": data.hsn_sac},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    db.refresh(product)
    return product


def update_product(
    db: Session, product_id: uuid.UUID, data: ProductCreate, actor: ActorContext
) -> Product:
    product = get_product(db, product_id)
    product.name = data.name
    product.hsn_sac = data.hsn_sac
    product.default_gst_rate = data.default_gst_rate
    product.default_uom = data.default_uom
    product.default_rate = data.default_rate
    product.is_active = data.is_active
    product.updated_by = actor.user_id
    record_audit(
        db,
        action="product.update",
        entity_type="product",
        entity_id=product.id,
        entity_reference=product.name,
        user_id=actor.user_id,
        after_data={"name": product.name},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    db.refresh(product)
    return product


# --------------------------------------------------------------------------- #
# Tax invoice
# --------------------------------------------------------------------------- #
def _load_invoice(db: Session, invoice_id: uuid.UUID) -> TaxInvoice:
    invoice = db.execute(
        select(TaxInvoice)
        .options(selectinload(TaxInvoice.lines))
        .where(TaxInvoice.id == invoice_id)
    ).scalar_one_or_none()
    if invoice is None:
        raise NotFoundError("Invoice not found")
    return invoice


def _resolve_buyer_snapshot(db: Session, data: InvoiceCreate | InvoiceUpdate) -> dict[str, object]:
    buyer: Buyer | None = None
    if data.buyer_id is not None:
        buyer = db.get(Buyer, data.buyer_id)
        if buyer is None:
            raise NotFoundError("Buyer not found")

    def pick(override: str | None, master: str | None) -> str | None:
        return override if override is not None else master

    name = pick(data.buyer_name, buyer.name if buyer else None)
    if not name:
        raise DomainError("Buyer name is required (select a buyer or enter a name)")
    return {
        "buyer_id": buyer.id if buyer else None,
        "buyer_name": name,
        "buyer_address": pick(data.buyer_address, buyer.address if buyer else None),
        "buyer_gstin": pick(data.buyer_gstin, buyer.gstin if buyer else None),
        "buyer_state_name": pick(data.buyer_state_name, buyer.state_name if buyer else None),
        "buyer_state_code": pick(data.buyer_state_code, buyer.state_code if buyer else None),
        "buyer_cell": pick(data.buyer_cell, buyer.cell if buyer else None),
    }


def _header_fields(data: InvoiceCreate | InvoiceUpdate) -> dict[str, object]:
    keys = (
        "delivery_note",
        "mode_terms_of_payment",
        "reference_no_date",
        "other_references",
        "buyers_order_no",
        "buyers_order_dated",
        "dispatch_doc_no",
        "delivery_note_date",
        "dispatched_through",
        "destination",
        "bill_of_lading_lr_rr_no",
        "motor_vehicle_no",
        "terms_of_delivery",
        "remarks",
        "declaration",
    )
    return {key: getattr(data, key) for key in keys}


def _build_lines(
    db: Session, invoice_id: uuid.UUID, inputs: list[InvoiceLineInput], actor: ActorContext
) -> list[TaxInvoiceLine]:
    lines: list[TaxInvoiceLine] = []
    for order, item in enumerate(inputs):
        hsn = item.hsn_sac
        if item.product_id is not None:
            product = db.get(Product, item.product_id)
            if product is None:
                raise NotFoundError(f"Product {item.product_id} not found")
            if hsn is None:
                hsn = product.hsn_sac
        taxable = _money(item.quantity * item.rate)
        gst_amount = _money(taxable * item.gst_rate / _HUNDRED)
        lines.append(
            TaxInvoiceLine(
                invoice_id=invoice_id,
                product_id=item.product_id,
                description=item.description,
                hsn_sac=hsn,
                quantity=item.quantity,
                uom=item.uom,
                rate=item.rate,
                taxable_amount=taxable,
                gst_rate=item.gst_rate,
                gst_amount=gst_amount,
                sort_order=order,
                created_by=actor.user_id,
                updated_by=actor.user_id,
            )
        )
    return lines


def _recompute_totals(invoice: TaxInvoice) -> None:
    taxable = sum((line.taxable_amount for line in invoice.lines), Decimal("0"))
    tax = sum((line.gst_amount for line in invoice.lines), Decimal("0"))
    invoice.taxable_amount = _money(taxable)
    invoice.total_tax_amount = _money(tax)
    invoice.round_off = Decimal("0.00")
    invoice.grand_total = _money(taxable + tax)


def _next_invoice_number(db: Session, explicit: str | None) -> tuple[str, str]:
    """Return (reference, invoice_number). ``reference`` is always the INV counter;
    ``invoice_number`` is the explicit value if given, else the padded counter."""
    reference = generate_reference(db, ReferencePrefix.INVOICE)
    if explicit:
        if (
            db.execute(
                select(TaxInvoice).where(TaxInvoice.invoice_number == explicit)
            ).scalar_one_or_none()
            is not None
        ):
            raise ConflictError(f"Invoice number '{explicit}' already exists")
        return reference, explicit
    seq = int(reference.split("-")[1])
    return reference, f"{seq:03d}"


def create_invoice(db: Session, data: InvoiceCreate, actor: ActorContext) -> TaxInvoice:
    mill = get_or_create_mill_settings(db)
    reference, invoice_number = _next_invoice_number(db, data.invoice_number)
    snapshot = _resolve_buyer_snapshot(db, data)

    invoice = TaxInvoice(
        reference=reference,
        invoice_number=invoice_number,
        invoice_date=data.invoice_date,
        status=InvoiceStatus.DRAFT,
        currency=mill.currency,
        declaration=data.declaration or mill.invoice_declaration,
        created_by=actor.user_id,
        updated_by=actor.user_id,
        **snapshot,
        **{k: v for k, v in _header_fields(data).items() if k != "declaration"},
    )
    db.add(invoice)
    db.flush()

    for line in _build_lines(db, invoice.id, data.lines, actor):
        db.add(line)
    db.flush()
    db.refresh(invoice)
    _recompute_totals(invoice)

    record_audit(
        db,
        action="tax_invoice.create",
        entity_type=_INVOICE_ENTITY,
        entity_id=invoice.id,
        entity_reference=invoice.invoice_number,
        user_id=actor.user_id,
        after_data={"grand_total": str(invoice.grand_total), "buyer": invoice.buyer_name},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    return _load_invoice(db, invoice.id)


def update_invoice(
    db: Session, invoice_id: uuid.UUID, data: InvoiceUpdate, actor: ActorContext
) -> TaxInvoice:
    invoice = _load_invoice(db, invoice_id)
    if invoice.status != InvoiceStatus.DRAFT:
        raise InvalidStateError("Only a DRAFT invoice can be edited")

    snapshot = _resolve_buyer_snapshot(db, data)
    for key, value in snapshot.items():
        setattr(invoice, key, value)
    for key, value in _header_fields(data).items():
        setattr(invoice, key, value)
    invoice.invoice_date = data.invoice_date
    invoice.updated_by = actor.user_id

    for existing in list(invoice.lines):
        db.delete(existing)
    db.flush()
    for line in _build_lines(db, invoice.id, data.lines, actor):
        db.add(line)
    db.flush()
    db.refresh(invoice)
    _recompute_totals(invoice)

    record_audit(
        db,
        action="tax_invoice.update",
        entity_type=_INVOICE_ENTITY,
        entity_id=invoice.id,
        entity_reference=invoice.invoice_number,
        user_id=actor.user_id,
        after_data={"grand_total": str(invoice.grand_total)},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    return _load_invoice(db, invoice_id)


def list_invoices(db: Session, page: int, page_size: int) -> tuple[list[TaxInvoice], int]:
    total = db.execute(select(func.count()).select_from(TaxInvoice)).scalar_one()
    rows = list(
        db.execute(
            select(TaxInvoice)
            .order_by(TaxInvoice.invoice_number)
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).scalars()
    )
    return rows, total


def get_invoice(db: Session, invoice_id: uuid.UUID) -> TaxInvoice:
    return _load_invoice(db, invoice_id)


def tax_summary(invoice: TaxInvoice) -> list[TaxSummaryLine]:
    """Aggregate taxable + GST by (HSN, rate) for the tax-summary table."""
    grouped: OrderedDict[tuple[str | None, Decimal], TaxSummaryLine] = OrderedDict()
    for line in sorted(invoice.lines, key=lambda x: x.sort_order):
        key = (line.hsn_sac, line.gst_rate)
        prev = grouped.get(key)
        if prev is None:
            grouped[key] = TaxSummaryLine(
                hsn_sac=line.hsn_sac,
                taxable_amount=line.taxable_amount,
                gst_rate=line.gst_rate,
                gst_amount=line.gst_amount,
            )
        else:
            grouped[key] = TaxSummaryLine(
                hsn_sac=prev.hsn_sac,
                taxable_amount=_money(prev.taxable_amount + line.taxable_amount),
                gst_rate=prev.gst_rate,
                gst_amount=_money(prev.gst_amount + line.gst_amount),
            )
    return list(grouped.values())


def amount_words(invoice: TaxInvoice) -> str:
    return indian_amount_in_words(invoice.grand_total, invoice.currency)


def tax_words(invoice: TaxInvoice) -> str:
    return indian_amount_in_words(invoice.total_tax_amount, invoice.currency)


def _qr_url(invoice: TaxInvoice) -> str | None:
    """Public "scan to download" URL for the invoice, or None if no token yet."""
    if not invoice.public_token:
        return None
    base = get_settings().public_app_base_url.rstrip("/")
    return f"{base}/i?token={invoice.public_token}"


def _render_pdf_bytes(db: Session, invoice: TaxInvoice) -> bytes:
    mill = get_or_create_mill_settings(db)
    return render_tax_invoice(
        TaxInvoiceContext(
            mill=mill,
            invoice=invoice,
            lines=sorted(invoice.lines, key=lambda x: x.sort_order),
            tax_summary=tax_summary(invoice),
            amount_in_words=amount_words(invoice),
            tax_amount_in_words=tax_words(invoice),
            copies=DEFAULT_COPIES,
            qr_url=_qr_url(invoice),
        )
    )


def render_pdf_bytes(db: Session, invoice_id: uuid.UUID) -> tuple[str, bytes]:
    """Render the invoice PDF live (no store) for preview/download fallback."""
    invoice = _load_invoice(db, invoice_id)
    if not invoice.lines:
        raise InvalidStateError("Cannot render a PDF for an invoice with no lines")
    return f"tax-invoice-{invoice.invoice_number}.pdf", _render_pdf_bytes(db, invoice)


def get_invoice_by_token(db: Session, token: str) -> TaxInvoice:
    """Look up an invoice by its public (QR) token. Powers the no-login endpoints."""
    invoice = db.execute(
        select(TaxInvoice)
        .options(selectinload(TaxInvoice.lines))
        .where(TaxInvoice.public_token == token)
    ).scalar_one_or_none()
    if invoice is None:
        raise NotFoundError("Invoice not found")
    return invoice


def render_public_pdf_bytes(db: Session, token: str) -> tuple[str, bytes]:
    """(filename, bytes) for the public QR download — prefer the stored PDF, else
    re-render. Mirrors the authenticated download's fallback behaviour."""
    invoice = get_invoice_by_token(db, token)
    if not invoice.lines:
        raise InvalidStateError("Cannot render a PDF for an invoice with no lines")
    if invoice.pdf_document_id is not None:
        try:
            document = get_document(db, invoice.pdf_document_id)
            return document.filename, read_document_bytes(document)
        except Exception:
            # Stored file unavailable (e.g. ephemeral disk wiped) — re-render.
            pass
    return f"tax-invoice-{invoice.invoice_number}.pdf", _render_pdf_bytes(db, invoice)


def generate_pdf(db: Session, invoice_id: uuid.UUID, actor: ActorContext) -> Document:
    invoice = _load_invoice(db, invoice_id)
    if not invoice.lines:
        raise InvalidStateError("Cannot generate a PDF for an invoice with no lines")
    document = store_document(
        db,
        entity_type=_INVOICE_ENTITY,
        entity_id=invoice.id,
        filename=f"tax-invoice-{invoice.invoice_number}.pdf",
        content_type="application/pdf",
        data=_render_pdf_bytes(db, invoice),
        key_prefix="tax-invoices",
        extension="pdf",
        created_by=actor.user_id,
    )
    invoice.pdf_document_id = document.id
    invoice.updated_by = actor.user_id
    record_audit(
        db,
        action="tax_invoice.pdf",
        entity_type=_INVOICE_ENTITY,
        entity_id=invoice.id,
        entity_reference=invoice.invoice_number,
        user_id=actor.user_id,
        after_data={"document_id": str(document.id)},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    db.refresh(document)
    return document


def issue_invoice(db: Session, invoice_id: uuid.UUID, actor: ActorContext) -> TaxInvoice:
    invoice = _load_invoice(db, invoice_id)
    if invoice.status != InvoiceStatus.DRAFT:
        raise InvalidStateError(f"Invoice cannot be issued from status {invoice.status}")
    if not invoice.lines:
        raise InvalidStateError("Invoice has no lines")
    invoice.status = InvoiceStatus.ISSUED
    invoice.issued_at = _now()
    invoice.updated_by = actor.user_id

    document = store_document(
        db,
        entity_type=_INVOICE_ENTITY,
        entity_id=invoice.id,
        filename=f"tax-invoice-{invoice.invoice_number}.pdf",
        content_type="application/pdf",
        data=_render_pdf_bytes(db, invoice),
        key_prefix="tax-invoices",
        extension="pdf",
        created_by=actor.user_id,
    )
    invoice.pdf_document_id = document.id
    record_audit(
        db,
        action="tax_invoice.issue",
        entity_type=_INVOICE_ENTITY,
        entity_id=invoice.id,
        entity_reference=invoice.invoice_number,
        user_id=actor.user_id,
        before_data={"status": InvoiceStatus.DRAFT},
        after_data={"status": invoice.status, "document_id": str(document.id)},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    return _load_invoice(db, invoice_id)


def attach_eway_bill(
    db: Session,
    invoice_id: uuid.UUID,
    *,
    filename: str,
    content_type: str,
    data: bytes,
    actor: ActorContext,
) -> Document:
    invoice = _load_invoice(db, invoice_id)
    document = store_document(
        db,
        entity_type="tax_invoice_eway",
        entity_id=invoice.id,
        filename=filename,
        content_type=content_type or "application/pdf",
        data=data,
        key_prefix="eway-bills",
        extension="pdf",
        created_by=actor.user_id,
    )
    invoice.eway_document_id = document.id
    invoice.updated_by = actor.user_id
    record_audit(
        db,
        action="tax_invoice.eway_upload",
        entity_type=_INVOICE_ENTITY,
        entity_id=invoice.id,
        entity_reference=invoice.invoice_number,
        user_id=actor.user_id,
        after_data={"document_id": str(document.id)},
        request_id=actor.request_id,
        ip_address=actor.ip_address,
    )
    db.commit()
    db.refresh(document)
    return document
