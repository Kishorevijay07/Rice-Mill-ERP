"""Invoicing models: buyer & product masters, tax invoices and their lines.

A tax invoice is a commercial GST sale to a private buyer (e.g. rice bran to a
trader) — distinct from a government claim. Buyer details are *snapshotted* onto
the invoice at creation so later edits to the master never mutate an issued
invoice. Money is NUMERIC — never float (rule 7); totals are computed server-side.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.shared.base_model import (
    AuditActorMixin,
    Base,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)

_MONEY = Numeric(14, 2)
_QTY = Numeric(14, 3)
_RATE = Numeric(14, 4)
_PCT = Numeric(5, 2)


class InvoiceStatus(StrEnum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"


def _new_public_token() -> str:
    """Unguessable token for public (QR-scan) invoice access. ~43 url-safe chars."""
    return secrets.token_urlsafe(32)


class Buyer(UUIDPrimaryKeyMixin, TimestampMixin, AuditActorMixin, Base):
    """Customer master — reusable buyer party for tax invoices."""

    __tablename__ = "buyers"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    state_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    state_code: Mapped[str | None] = mapped_column(String(4), nullable=True)
    cell: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )


class Product(UUIDPrimaryKeyMixin, TimestampMixin, AuditActorMixin, Base):
    """Item master — reusable saleable product (rice, bran, husk, ...)."""

    __tablename__ = "products"
    __table_args__ = (CheckConstraint("default_gst_rate >= 0", name="gst_rate_non_negative"),)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hsn_sac: Mapped[str | None] = mapped_column(String(16), nullable=True)
    default_gst_rate: Mapped[Decimal] = mapped_column(_PCT, nullable=False, default=Decimal("0"))
    default_uom: Mapped[str] = mapped_column(String(8), nullable=False, default="MT")
    default_rate: Mapped[Decimal | None] = mapped_column(_RATE, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )


class TaxInvoice(UUIDPrimaryKeyMixin, TimestampMixin, AuditActorMixin, Base):
    __tablename__ = "tax_invoices"
    __table_args__ = (
        CheckConstraint("taxable_amount >= 0", name="taxable_non_negative"),
        CheckConstraint("total_tax_amount >= 0", name="tax_non_negative"),
        CheckConstraint("grand_total >= 0", name="grand_total_non_negative"),
    )

    reference: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    # Human invoice number as printed (e.g. "003"); distinct from the reference.
    invoice_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    # Unguessable token behind the QR code — anyone with it can view/download this
    # one invoice via the public (no-login) endpoints. Auto-generated on insert.
    public_token: Mapped[str] = mapped_column(
        String(64), unique=True, index=True, nullable=False, default=_new_public_token
    )
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default=InvoiceStatus.DRAFT,
        server_default=text(f"'{InvoiceStatus.DRAFT}'"),
        index=True,
    )
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")

    # ---- Buyer snapshot (+ optional link to the master) ----
    buyer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("buyers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    buyer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    buyer_address: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    buyer_gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    buyer_state_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    buyer_state_code: Mapped[str | None] = mapped_column(String(4), nullable=True)
    buyer_cell: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # ---- Tally header grid (all optional, free text) ----
    delivery_note: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mode_terms_of_payment: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reference_no_date: Mapped[str | None] = mapped_column(String(128), nullable=True)
    other_references: Mapped[str | None] = mapped_column(String(128), nullable=True)
    buyers_order_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    buyers_order_dated: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dispatch_doc_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    delivery_note_date: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dispatched_through: Mapped[str | None] = mapped_column(String(128), nullable=True)
    destination: Mapped[str | None] = mapped_column(String(128), nullable=True)
    bill_of_lading_lr_rr_no: Mapped[str | None] = mapped_column(String(128), nullable=True)
    motor_vehicle_no: Mapped[str | None] = mapped_column(String(32), nullable=True)
    terms_of_delivery: Mapped[str | None] = mapped_column(String(255), nullable=True)
    remarks: Mapped[str | None] = mapped_column(String(255), nullable=True)
    declaration: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    # ---- Server-computed totals ----
    taxable_amount: Mapped[Decimal] = mapped_column(_MONEY, nullable=False, default=Decimal("0"))
    total_tax_amount: Mapped[Decimal] = mapped_column(_MONEY, nullable=False, default=Decimal("0"))
    round_off: Mapped[Decimal] = mapped_column(_MONEY, nullable=False, default=Decimal("0"))
    grand_total: Mapped[Decimal] = mapped_column(_MONEY, nullable=False, default=Decimal("0"))

    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pdf_document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    eway_document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )

    lines: Mapped[list[TaxInvoiceLine]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )


class TaxInvoiceLine(UUIDPrimaryKeyMixin, TimestampMixin, AuditActorMixin, Base):
    __tablename__ = "tax_invoice_lines"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="quantity_non_negative"),
        CheckConstraint("rate >= 0", name="rate_non_negative"),
        CheckConstraint("gst_rate >= 0", name="line_gst_rate_non_negative"),
        CheckConstraint("bags IS NULL OR bags >= 0", name="bags_non_negative"),
    )

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tax_invoices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str] = mapped_column(String(1000), nullable=False)
    bags: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hsn_sac: Mapped[str | None] = mapped_column(String(16), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(_QTY, nullable=False)
    uom: Mapped[str] = mapped_column(String(8), nullable=False, default="MT")
    rate: Mapped[Decimal] = mapped_column(_RATE, nullable=False)
    taxable_amount: Mapped[Decimal] = mapped_column(_MONEY, nullable=False)
    gst_rate: Mapped[Decimal] = mapped_column(_PCT, nullable=False, default=Decimal("0"))
    gst_amount: Mapped[Decimal] = mapped_column(_MONEY, nullable=False, default=Decimal("0"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    invoice: Mapped[TaxInvoice] = relationship(back_populates="lines")
