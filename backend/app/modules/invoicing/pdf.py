"""GST tax-invoice rendering (fpdf2 -> PDF bytes), Tally-style layout.

Reproduces the bordered "TAX INVOICE" grid: seller/buyer blocks, the reference
header grid, the line-item table with a per-line GST sub-row, totals, amount in
words, the HSN tax summary, bank details, declaration and signature.

The Rupee glyph (Rs.) is printed as the latin-1-safe "Rs." with the core fonts.
Drop an OFL/public-domain Unicode TTF at ``assets/DejaVuSans.ttf`` (or set
``UNICODE_FONT_PATH``) to render the "Rupee" symbol instead — the renderer picks
it up automatically and falls back cleanly when it is absent.

One PDF carries a single page ("ORIGINAL FOR RECIPIENT").
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

import segno
from fpdf import FPDF

from app.modules.invoicing.models import TaxInvoice, TaxInvoiceLine
from app.modules.settings.models import MillSettings
from app.shared.numbers import gst_components, is_interstate

_ASSET_FONT = Path(__file__).with_name("assets") / "DejaVuSans.ttf"

# Page geometry (A4, mm).
_LM = 8.0
_RM = 8.0
_PAGE_W = 210.0
_CONTENT_W = _PAGE_W - _LM - _RM  # 194

# Line-item columns (x offsets from _LM, widths sum to _CONTENT_W).
_COLS = {
    "sl": 10.0,
    "desc": 64.0,
    "hsn": 22.0,
    "qty": 22.0,
    "rate": 26.0,
    "per": 12.0,
    "amount": 38.0,
}

DEFAULT_COPIES: tuple[str, ...] = (
    "ORIGINAL FOR RECIPIENT",
)


@dataclass(frozen=True)
class TaxSummaryLine:
    hsn_sac: str | None
    taxable_amount: Decimal
    gst_rate: Decimal
    gst_amount: Decimal


@dataclass(frozen=True)
class TaxInvoiceContext:
    mill: MillSettings
    invoice: TaxInvoice
    lines: list[TaxInvoiceLine]
    tax_summary: list[TaxSummaryLine]
    amount_in_words: str
    tax_amount_in_words: str
    copies: tuple[str, ...] = DEFAULT_COPIES
    # Absolute URL encoded into the "scan to download" QR (public invoice page).
    qr_url: str | None = None


def _qr_png(url: str, *, scale: int = 4) -> io.BytesIO:
    """Render ``url`` as a PNG QR code (pure-Python segno; fpdf2 embeds PNG natively)."""
    buf = io.BytesIO()
    segno.make(url, error="m").save(buf, kind="png", scale=scale, border=1)
    buf.seek(0)
    return buf


class _InvoicePDF(FPDF):
    def __init__(self) -> None:
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_auto_page_break(auto=False)
        self.set_margins(_LM, 8.0, _RM)
        self.unicode = False
        self.family = "Helvetica"
        if _ASSET_FONT.exists():
            try:
                self.add_font("DejaVu", "", str(_ASSET_FONT))
                self.add_font("DejaVu", "B", str(_ASSET_FONT))
                self.add_font("DejaVu", "I", str(_ASSET_FONT))
                self.family = "DejaVu"
                self.unicode = True
            except Exception:  # pragma: no cover - font fallback is best-effort
                self.family = "Helvetica"
                self.unicode = False

    def money(self, value: Decimal) -> str:
        symbol = "₹ " if self.unicode else "Rs."
        return f"{symbol}{value:,.2f}"

    def safe(self, text: object) -> str:
        s = "" if text is None else str(text)
        if self.unicode:
            return s
        return s.encode("latin-1", "replace").decode("latin-1")


def _label_value(
    pdf: _InvoicePDF, x: float, y: float, w: float, h: float, label: str, value: str
) -> None:
    """A bordered cell with a small grey label and a value beneath it."""
    pdf.rect(x, y, w, h)
    pdf.set_xy(x + 1, y + 0.6)
    pdf.set_font(pdf.family, "", 7)
    pdf.set_text_color(110, 110, 110)
    pdf.cell(w - 2, 3, pdf.safe(label))
    pdf.set_text_color(0, 0, 0)
    if value:
        pdf.set_xy(x + 1, y + 3.6)
        pdf.set_font(pdf.family, "B", 8.5)
        pdf.cell(w - 2, 4, pdf.safe(value))


def _multiline(
    pdf: _InvoicePDF,
    x: float,
    y: float,
    w: float,
    lines: list[str],
    size: float,
    bold: bool = False,
    gap: float = 4.0,
) -> float:
    pdf.set_font(pdf.family, "B" if bold else "", size)
    cy = y
    for ln in lines:
        pdf.set_xy(x, cy)
        pdf.cell(w, gap, pdf.safe(ln))
        cy += gap
    return cy


def _multiline_wrap(
    pdf: _InvoicePDF,
    x: float,
    y: float,
    w: float,
    lines: list[str],
    size: float,
    gap: float = 4.2,
) -> float:
    """Like ``_multiline`` but wraps each line within width ``w`` so long address
    lines cannot spill past the column into the neighbouring cells."""
    pdf.set_font(pdf.family, "", size)
    cy = y
    for ln in lines:
        pdf.set_xy(x, cy)
        pdf.multi_cell(w, gap, pdf.safe(ln), align="L", new_x="LEFT", new_y="NEXT")
        cy = pdf.get_y()
    return cy


def _render_page(pdf: _InvoicePDF, ctx: TaxInvoiceContext, copy_label: str) -> None:
    inv = ctx.invoice
    mill = ctx.mill
    interstate = is_interstate(mill.state_code, inv.buyer_state_code)
    pdf.add_page()
    x0 = _LM
    right_x = _LM + _CONTENT_W
    y = 8.0

    # ---- Title band ----
    pdf.rect(x0, y, _CONTENT_W, 8)
    pdf.set_font(pdf.family, "B", 13)
    pdf.set_xy(x0, y + 1)
    pdf.cell(_CONTENT_W, 6, "TAX INVOICE", align="C")
    pdf.set_font(pdf.family, "", 7)
    pdf.set_xy(right_x - 60, y + 2.4)
    pdf.cell(58, 4, pdf.safe(copy_label), align="R")
    y += 8

    half = _CONTENT_W / 2  # 97
    mid_x = x0 + half

    # ---- Band A: seller (left) / invoice no + dated (right) ----
    band_a_h = 30.0
    pdf.rect(x0, y, half, band_a_h)
    sy = _multiline(pdf, x0 + 1.5, y + 2, half - 3, [mill.name], 12, bold=True, gap=6)
    seller_lines = [
        mill.address or "",
        f"State : {mill.state_name or ''}   Code: {mill.state_code or ''}",
        f"GSTIN/UIN : {mill.gstin or ''}",
        f"E-Mail : {mill.contact_email or ''}",
    ]
    _multiline_wrap(
        pdf, x0 + 1.5, sy, half - 4, [ln for ln in seller_lines if ln.strip()], 8, gap=4.2
    )

    # Right column of band A: two stacked reference rows (Invoice No/Dated first).
    rw = half / 2
    _label_value(pdf, mid_x, y, rw, 8, "Invoice No.", inv.invoice_number)
    _label_value(pdf, mid_x + rw, y, rw, 8, "Dated", inv.invoice_date.strftime("%d/%m/%Y"))
    grid_pairs = [
        ("Delivery Note", inv.delivery_note, "Mode/Terms of Payment", inv.mode_terms_of_payment),
        ("Reference No. & Date", inv.reference_no_date, "Other References", inv.other_references),
    ]
    ry = y + 8
    row_h = (band_a_h - 8) / len(grid_pairs)
    for l1, v1, l2, v2 in grid_pairs:
        _label_value(pdf, mid_x, ry, rw, row_h, l1, pdf.safe(v1 or ""))
        _label_value(pdf, mid_x + rw, ry, rw, row_h, l2, pdf.safe(v2 or ""))
        ry += row_h
    y += band_a_h

    # ---- Band B: buyer (left) / dispatch grid (right) ----
    band_b_h = 40.0
    pdf.rect(x0, y, half, band_b_h)
    pdf.set_xy(x0 + 1.5, y + 1.5)
    pdf.set_font(pdf.family, "", 8)
    pdf.cell(half - 3, 4, "BUYER (Bill to)")
    by = _multiline(pdf, x0 + 1.5, y + 6, half - 3, [inv.buyer_name], 11, bold=True, gap=5.5)
    buyer_lines = [
        inv.buyer_address or "",
        f"GSTIN/UIN : {inv.buyer_gstin or ''}",
        f"State : {inv.buyer_state_name or ''}   Code : {inv.buyer_state_code or ''}",
        f"CELL No: {inv.buyer_cell or ''}",
    ]
    _multiline_wrap(
        pdf, x0 + 1.5, by, half - 4, [ln for ln in buyer_lines if ln.strip()], 8, gap=4.2
    )

    dispatch_pairs = [
        ("Buyer's Order No.", inv.buyers_order_no, "Dated", inv.buyers_order_dated),
        ("Dispatch Doc No.", inv.dispatch_doc_no, "Delivery Note Date", inv.delivery_note_date),
        ("Dispatched through", inv.dispatched_through, "Destination", inv.destination),
        (
            "Bill of Lading/LR-RR No.",
            inv.bill_of_lading_lr_rr_no,
            "Motor Vehicle No.",
            inv.motor_vehicle_no,
        ),
    ]
    grid_h = band_b_h - 7
    drow_h = grid_h / len(dispatch_pairs)
    dy = y
    for l1, v1, l2, v2 in dispatch_pairs:
        _label_value(pdf, mid_x, dy, rw, drow_h, l1, pdf.safe(v1 or ""))
        _label_value(pdf, mid_x + rw, dy, rw, drow_h, l2, pdf.safe(v2 or ""))
        dy += drow_h
    _label_value(
        pdf,
        mid_x,
        dy,
        half,
        band_b_h - grid_h,
        "Terms of Delivery",
        pdf.safe(inv.terms_of_delivery or ""),
    )
    y += band_b_h

    # ---- Line items table ----
    xs = _col_x()
    header_h = 7.0
    pdf.set_fill_color(240, 240, 240)
    pdf.set_font(pdf.family, "B", 8)
    headers = [
        ("sl", "Sl No.", "C"),
        ("desc", "Description of Goods", "L"),
        ("hsn", "HSN/SAC", "C"),
        ("qty", "Quantity", "C"),
        ("rate", "Rate", "C"),
        ("per", "per", "C"),
        ("amount", "Amount", "C"),
    ]
    for key, label, align in headers:
        pdf.rect(xs[key], y, _COLS[key], header_h, style="DF")
        pdf.set_xy(xs[key], y + 1.5)
        pdf.cell(_COLS[key], 4, label, align=align)
    y += header_h

    body_top = y
    pdf.set_font(pdf.family, "", 8)
    for idx, line in enumerate(ctx.lines, start=1):
        desc_lines = str(line.description).split("\n")
        main_h = max(len(desc_lines) * 4.2 + 2, 10.0)
        # Sl / HSN / Qty / Rate / per / Amount cells for the main line.
        pdf.set_xy(xs["sl"], y + 1.5)
        pdf.cell(_COLS["sl"], 4, str(idx), align="C")
        _multiline(pdf, xs["desc"] + 1, y + 1.5, _COLS["desc"] - 2, desc_lines, 8, gap=4.2)
        pdf.set_xy(xs["hsn"], y + 1.5)
        pdf.cell(_COLS["hsn"], 4, pdf.safe(line.hsn_sac or ""), align="C")
        pdf.set_xy(xs["qty"], y + 1.5)
        pdf.cell(_COLS["qty"] - 1, 4, f"{line.quantity:,.2f}", align="R")
        pdf.set_xy(xs["rate"], y + 1.5)
        pdf.cell(_COLS["rate"] - 1, 4, pdf.money(line.rate), align="R")
        pdf.set_xy(xs["per"], y + 1.5)
        pdf.cell(_COLS["per"], 4, pdf.safe(line.uom), align="C")
        pdf.set_xy(xs["amount"], y + 1.5)
        pdf.cell(_COLS["amount"] - 1, 4, pdf.money(line.taxable_amount), align="R")
        y += main_h

        # Tax sub-rows: IGST (inter-state) or CGST + SGST (intra-state).
        comp = gst_components(line.gst_rate, line.gst_amount, interstate=interstate)
        if interstate:
            sub_rows = [(f"OUTPUT IGST @ {comp.igst_rate:g}%", comp.igst_rate, comp.igst_amount)]
        else:
            sub_rows = [
                (f"OUTPUT CGST @ {comp.cgst_rate:g}%", comp.cgst_rate, comp.cgst_amount),
                (f"OUTPUT SGST @ {comp.sgst_rate:g}%", comp.sgst_rate, comp.sgst_amount),
            ]
        for label, rate_val, amt in sub_rows:
            pdf.set_xy(xs["desc"] + 1, y + 1)
            pdf.cell(_COLS["desc"] - 2, 4, pdf.safe(label))
            pdf.set_xy(xs["rate"], y + 1)
            pdf.cell(_COLS["rate"] - 1, 4, f"{rate_val:g}%", align="R")
            pdf.set_xy(xs["amount"], y + 1)
            pdf.cell(_COLS["amount"] - 1, 4, pdf.money(amt), align="R")
            y += 5.0

    # Pad the body to a minimum height, then draw column borders over the block.
    min_body_bottom = body_top + 45
    if y < min_body_bottom:
        y = min_body_bottom
    for key in _COLS:
        pdf.rect(xs[key], body_top, _COLS[key], y - body_top)

    # Total row.
    total_h = 7.0
    label_w = (
        _COLS["sl"] + _COLS["desc"] + _COLS["hsn"] + _COLS["qty"] + _COLS["rate"] + _COLS["per"]
    )
    pdf.rect(xs["sl"], y, label_w, total_h)
    pdf.rect(xs["amount"], y, _COLS["amount"], total_h)
    pdf.set_font(pdf.family, "B", 9)
    pdf.set_xy(xs["sl"], y + 1.5)
    pdf.cell(label_w - 2, 4, "Total", align="R")
    pdf.set_xy(xs["amount"], y + 1.5)
    pdf.cell(_COLS["amount"] - 1, 4, pdf.money(inv.grand_total), align="R")
    y += total_h

    # ---- Amount in words ----
    words_h = 9.0
    pdf.rect(x0, y, _CONTENT_W, words_h)
    pdf.set_xy(x0 + 1.5, y + 1)
    pdf.set_font(pdf.family, "", 7.5)
    pdf.cell(_CONTENT_W - 3, 3.5, "Amount Chargeable (in words)")
    pdf.set_xy(x0 + 1.5, y + 4.4)
    pdf.set_font(pdf.family, "B", 9)
    pdf.cell(_CONTENT_W - 3, 4, pdf.safe(ctx.amount_in_words))
    y += words_h

    # ---- HSN tax summary (IGST for inter-state, else CGST + SGST) ----
    if interstate:
        ts_cols = [
            ("HSN/SAC", 46.0),
            ("Taxable Value", 44.0),
            ("IGST Rate", 24.0),
            ("IGST Amount", 40.0),
            ("Total TAX", 40.0),
        ]
    else:
        ts_cols = [
            ("HSN/SAC", 38.0),
            ("Taxable Value", 34.0),
            ("CGST Rate", 16.0),
            ("CGST Amt", 27.0),
            ("SGST Rate", 16.0),
            ("SGST Amt", 27.0),
            ("Total TAX", 36.0),
        ]
    th = 6.5
    cx = x0
    pdf.set_font(pdf.family, "B", 8)
    pdf.set_fill_color(240, 240, 240)
    for label, w in ts_cols:
        pdf.rect(cx, y, w, th, style="DF")
        pdf.set_xy(cx, y + 1.4)
        pdf.cell(w, 4, label, align="C")
        cx += w
    y += th
    pdf.set_font(pdf.family, "", 8)
    total_taxable = total_tax = Decimal("0")
    for row in ctx.tax_summary:
        comp = gst_components(row.gst_rate, row.gst_amount, interstate=interstate)
        total_taxable += row.taxable_amount
        total_tax += row.gst_amount
        cx = x0
        if interstate:
            vals = [
                (pdf.safe(row.hsn_sac or ""), "L"),
                (f"{row.taxable_amount:,.2f}", "R"),
                (f"{comp.igst_rate:g}%", "C"),
                (f"{comp.igst_amount:,.2f}", "R"),
                (f"{row.gst_amount:,.2f}", "R"),
            ]
        else:
            vals = [
                (pdf.safe(row.hsn_sac or ""), "L"),
                (f"{row.taxable_amount:,.2f}", "R"),
                (f"{comp.cgst_rate:g}%", "C"),
                (f"{comp.cgst_amount:,.2f}", "R"),
                (f"{comp.sgst_rate:g}%", "C"),
                (f"{comp.sgst_amount:,.2f}", "R"),
                (f"{row.gst_amount:,.2f}", "R"),
            ]
        for (_label, w), (val, align) in zip(ts_cols, vals, strict=True):
            pdf.rect(cx, y, w, th)
            pdf.set_xy(cx + 0.5, y + 1.4)
            pdf.cell(w - 1, 4, val, align=align)
            cx += w
        y += th
    # Tax summary total row.
    cx = x0
    if interstate:
        totals = [
            ("Total", "R"),
            (f"{total_taxable:,.2f}", "R"),
            ("", "C"),
            (f"{total_tax:,.2f}", "R"),
            (f"{total_tax:,.2f}", "R"),
        ]
    else:
        half_tax = (total_tax / Decimal(2)).quantize(Decimal("0.01"))
        totals = [
            ("Total", "R"),
            (f"{total_taxable:,.2f}", "R"),
            ("", "C"),
            (f"{half_tax:,.2f}", "R"),
            ("", "C"),
            (f"{total_tax - half_tax:,.2f}", "R"),
            (f"{total_tax:,.2f}", "R"),
        ]
    pdf.set_font(pdf.family, "B", 8)
    for (_label, w), (val, align) in zip(ts_cols, totals, strict=True):
        pdf.rect(cx, y, w, th)
        pdf.set_xy(cx + 0.5, y + 1.4)
        pdf.cell(w - 1, 4, val, align=align)
        cx += w
    y += th

    # Tax amount in words.
    pdf.rect(x0, y, _CONTENT_W, 6)
    pdf.set_xy(x0 + 1.5, y + 1.2)
    pdf.set_font(pdf.family, "", 8)
    pdf.cell(_CONTENT_W - 3, 4, pdf.safe(f"Tax amount (in words) : {ctx.tax_amount_in_words}"))
    y += 6

    # ---- Remarks/Declaration (left) + Bank details (right) ----
    foot_h = 34.0
    pdf.rect(x0, y, half, foot_h)
    pdf.set_xy(x0 + 1.5, y + 1.5)
    remarks_val = inv.remarks
    if not remarks_val or not remarks_val.strip():
        line_names = []
        for ln in ctx.lines:
            ln_desc = (ln.description or "").strip().split("\n")[0]
            if "[" in ln_desc:
                ln_desc = ln_desc.split("[")[0].strip()
            if ln_desc and ln_desc not in line_names:
                line_names.append(ln_desc)
        if line_names:
            remarks_val = ", ".join(line_names)
    pdf.cell(half - 3, 4, pdf.safe(f"Remarks: {remarks_val or ''}"))
    pdf.set_xy(x0 + 1.5, y + 7)
    pdf.set_font(pdf.family, "B", 8)
    pdf.cell(half - 3, 4, "Declaration")
    # Reserve room on the right of this cell for the QR when present.
    qr_size = 20.0
    decl_w = half - 3 - (qr_size + 4 if ctx.qr_url else 0)
    pdf.set_xy(x0 + 1.5, y + 11)
    pdf.set_font(pdf.family, "", 7.5)
    pdf.multi_cell(decl_w, 3.6, pdf.safe(inv.declaration or mill.invoice_declaration or ""))
    if ctx.qr_url:
        qr_x = x0 + half - qr_size - 2.0
        qr_y = y + 8.0
        pdf.image(_qr_png(ctx.qr_url), x=qr_x, y=qr_y, w=qr_size, h=qr_size)
        pdf.set_xy(qr_x - 2, qr_y + qr_size)
        pdf.set_font(pdf.family, "", 6)
        pdf.cell(qr_size + 4, 3, "Scan to download", align="C")

    pdf.rect(mid_x, y, half, foot_h)
    pdf.set_xy(mid_x + 1.5, y + 1.5)
    pdf.set_font(pdf.family, "B", 8)
    pdf.cell(half - 3, 4, "Company's Bank Details")
    bank_lines = [
        f"A/c Holder's Name : {mill.bank_account_name or mill.name}",
        f"Bank : {mill.bank_name or ''}",
        f"A/c No. : {mill.bank_account_no or ''}",
        f"Branch : {mill.bank_branch or ''}",
        f"IFSC Code : {mill.bank_ifsc or ''}",
    ]
    _multiline(pdf, mid_x + 1.5, y + 6, half - 3, bank_lines, 8, gap=4.2)
    pdf.set_xy(mid_x + 1.5, y + foot_h - 12)
    pdf.set_font(pdf.family, "B", 8)
    pdf.cell(half - 3, 4, pdf.safe(f"for {mill.name}"), align="R")
    pdf.set_xy(mid_x + 1.5, y + foot_h - 4)
    pdf.set_font(pdf.family, "", 7)
    pdf.cell(half - 3, 3, "Authorised Signatory", align="R")


def _col_x() -> dict[str, float]:
    xs: dict[str, float] = {}
    cx = _LM
    for key, w in _COLS.items():
        xs[key] = cx
        cx += w
    return xs


def render_tax_invoice(ctx: TaxInvoiceContext) -> bytes:
    pdf = _InvoicePDF()
    copies = ctx.copies or ("",)
    for label in copies:
        _render_page(pdf, ctx, label)
    return bytes(pdf.output())
