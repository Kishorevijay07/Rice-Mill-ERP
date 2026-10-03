"""Pydantic schemas for the invoicing API (buyers, products, tax invoices)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


# --------------------------------------------------------------------------- #
# Buyer master
# --------------------------------------------------------------------------- #
class BuyerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    address: str | None = Field(default=None, max_length=1000)
    gstin: str | None = Field(default=None, max_length=20)
    state_name: str | None = Field(default=None, max_length=64)
    state_code: str | None = Field(default=None, max_length=4)
    cell: str | None = Field(default=None, max_length=32)
    is_active: bool = True


class BuyerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    address: str | None
    gstin: str | None
    state_name: str | None
    state_code: str | None
    cell: str | None
    is_active: bool


# --------------------------------------------------------------------------- #
# Product master
# --------------------------------------------------------------------------- #
class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    hsn_sac: str | None = Field(default=None, max_length=16)
    default_gst_rate: Decimal = Field(
        default=Decimal("0"), ge=0, le=100, max_digits=5, decimal_places=2
    )
    default_uom: str = Field(default="MT", min_length=1, max_length=8)
    default_rate: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=4)
    is_active: bool = True


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    hsn_sac: str | None
    default_gst_rate: Decimal
    default_uom: str
    default_rate: Decimal | None
    is_active: bool


# --------------------------------------------------------------------------- #
# Tax invoice
# --------------------------------------------------------------------------- #
class InvoiceLineInput(BaseModel):
    product_id: uuid.UUID | None = None
    description: str = Field(min_length=1, max_length=1000)
    bags: int | None = Field(default=None, ge=0)
    hsn_sac: str | None = Field(default=None, max_length=16)
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    uom: str = Field(default="MT", min_length=1, max_length=8)
    rate: Decimal = Field(ge=0, max_digits=14, decimal_places=4)
    gst_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=5, decimal_places=2)


class _InvoiceHeader(BaseModel):
    invoice_date: date
    # Optional explicit number; the service auto-assigns a sequential one if omitted.
    invoice_number: str | None = Field(default=None, max_length=32)
    buyer_id: uuid.UUID | None = None
    # Buyer snapshot overrides (used when no buyer_id, or to override master values).
    buyer_name: str | None = Field(default=None, max_length=255)
    buyer_address: str | None = Field(default=None, max_length=1000)
    buyer_gstin: str | None = Field(default=None, max_length=20)
    buyer_state_name: str | None = Field(default=None, max_length=64)
    buyer_state_code: str | None = Field(default=None, max_length=4)
    buyer_cell: str | None = Field(default=None, max_length=32)

    delivery_note: str | None = Field(default=None, max_length=64)
    mode_terms_of_payment: str | None = Field(default=None, max_length=128)
    reference_no_date: str | None = Field(default=None, max_length=128)
    other_references: str | None = Field(default=None, max_length=128)
    buyers_order_no: str | None = Field(default=None, max_length=64)
    buyers_order_dated: str | None = Field(default=None, max_length=64)
    dispatch_doc_no: str | None = Field(default=None, max_length=64)
    delivery_note_date: str | None = Field(default=None, max_length=64)
    dispatched_through: str | None = Field(default=None, max_length=128)
    destination: str | None = Field(default=None, max_length=128)
    bill_of_lading_lr_rr_no: str | None = Field(default=None, max_length=128)
    motor_vehicle_no: str | None = Field(default=None, max_length=32)
    terms_of_delivery: str | None = Field(default=None, max_length=255)
    remarks: str | None = Field(default=None, max_length=255)
    declaration: str | None = Field(default=None, max_length=1000)


class InvoiceCreate(_InvoiceHeader):
    lines: list[InvoiceLineInput] = Field(min_length=1)


class InvoiceUpdate(_InvoiceHeader):
    lines: list[InvoiceLineInput] = Field(min_length=1)


class InvoiceLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    product_id: uuid.UUID | None
    description: str
    bags: int | None = None
    hsn_sac: str | None
    quantity: Decimal
    uom: str
    rate: Decimal
    taxable_amount: Decimal
    gst_rate: Decimal
    gst_amount: Decimal
    cgst_rate: Decimal
    cgst_amount: Decimal
    sgst_rate: Decimal
    sgst_amount: Decimal
    igst_rate: Decimal
    igst_amount: Decimal
    sort_order: int


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference: str
    invoice_number: str
    invoice_date: date
    status: str
    currency: str
    buyer_id: uuid.UUID | None
    buyer_name: str
    buyer_address: str | None
    buyer_gstin: str | None
    buyer_state_name: str | None
    buyer_state_code: str | None
    buyer_cell: str | None
    destination: str | None
    motor_vehicle_no: str | None
    remarks: str | None
    taxable_amount: Decimal
    total_tax_amount: Decimal
    round_off: Decimal
    grand_total: Decimal
    issued_at: datetime | None
    pdf_document_id: uuid.UUID | None
    eway_document_id: uuid.UUID | None
    created_at: datetime


class TaxSummaryRow(BaseModel):
    hsn_sac: str | None
    taxable_amount: Decimal
    gst_rate: Decimal
    gst_amount: Decimal
    cgst_rate: Decimal
    cgst_amount: Decimal
    sgst_rate: Decimal
    sgst_amount: Decimal
    igst_rate: Decimal
    igst_amount: Decimal


class InvoiceDetail(InvoiceOut):
    # Full header echo (edit form needs the Tally grid fields back).
    delivery_note: str | None
    mode_terms_of_payment: str | None
    reference_no_date: str | None
    other_references: str | None
    buyers_order_no: str | None
    buyers_order_dated: str | None
    dispatch_doc_no: str | None
    delivery_note_date: str | None
    dispatched_through: str | None
    bill_of_lading_lr_rr_no: str | None
    terms_of_delivery: str | None
    declaration: str | None
    # Unguessable token behind the printed QR; lets the UI show a shareable link.
    public_token: str
    is_interstate: bool
    lines: list[InvoiceLineOut]
    tax_summary: list[TaxSummaryRow]
    amount_in_words: str
    tax_amount_in_words: str


class DocumentResponse(BaseModel):
    document_id: uuid.UUID
    filename: str


class PublicInvoiceSummary(BaseModel):
    """Minimal, non-sensitive summary shown on the public QR landing page."""

    invoice_number: str
    invoice_date: date
    seller_name: str
    buyer_name: str
    grand_total: Decimal
    currency: str
    status: str
