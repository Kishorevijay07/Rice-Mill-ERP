"""Invoicing tests: buyer/product masters, GST tax-invoice totals + amount in
words, issue/lock, PDF generation, e-Way upload, and permission enforcement.
"""

from __future__ import annotations

from decimal import Decimal

from app.shared.numbers import indian_amount_in_words


def _login(client, identifier: str, password: str):
    return client.post(
        "/api/v1/auth/login",
        json={"identifier": identifier, "password": password},
    )


def _users(make_user) -> None:
    make_user(
        email="owner@example.com",
        username="owner",
        password="owner-passphrase-1",
        role_codes=("OWNER",),
    )
    make_user(
        email="staff@example.com",
        username="staff",
        password="staff-passphrase-1",
        role_codes=("STAFF",),
    )


def _buyer(client) -> str:
    return str(
        client.post(
            "/api/v1/buyers",
            json={
                "name": "Vellaya Gounder Traders",
                "address": "PERAMANDAPPATTY, KAMBAINALLUR",
                "gstin": "33BFWPP8062H1ZU",
                "state_name": "TAMILNADU",
                "state_code": "33",
                "cell": "8608102317",
            },
        ).json()["id"]
    )


def _product(client) -> str:
    return str(
        client.post(
            "/api/v1/products",
            json={
                "name": "RICE BRAN",
                "hsn_sac": "23022020",
                "default_gst_rate": "5.00",
                "default_uom": "MT",
                "default_rate": "22000.0000",
            },
        ).json()["id"]
    )


def _invoice_payload(buyer_id: str, product_id: str) -> dict[str, object]:
    return {
        "invoice_date": "2026-09-01",
        "invoice_number": "003",
        "buyer_id": buyer_id,
        "dispatched_through": "LORRY/ROAD",
        "destination": "KAMBAINALLUR",
        "motor_vehicle_no": "TN 52 W 1819",
        "remarks": "RICE BRAN",
        "lines": [
            {
                "product_id": product_id,
                "description": "RICE BRAN\n[530 BAGS,WT.24.69 MT]\nRATE @22000/- MT + GST",
                "hsn_sac": "23022020",
                "quantity": "24.690",
                "uom": "MT",
                "rate": "22000.0000",
                "gst_rate": "5.00",
            }
        ],
    }


# --------------------------------------------------------------------------- #
# Amount in words (pure util)
# --------------------------------------------------------------------------- #
def test_amount_in_words() -> None:
    assert (
        indian_amount_in_words(Decimal("570339"))
        == "INR Five Lakhs Seventy Thousand Three Hundred and Thirty Nine Only"
    )
    assert (
        indian_amount_in_words(Decimal("27159"))
        == "INR Twenty Seven Thousand One Hundred and Fifty Nine Only"
    )
    assert indian_amount_in_words(Decimal("0")) == "INR Zero Only"
    assert indian_amount_in_words(Decimal("100")) == "INR One Hundred Only"
    assert (
        indian_amount_in_words(Decimal("1234567.50"))
        == "INR Twelve Lakhs Thirty Four Thousand Five Hundred and Sixty Seven and Fifty Paise Only"
    )


# --------------------------------------------------------------------------- #
# Full flow
# --------------------------------------------------------------------------- #
def test_tax_invoice_totals_and_issue(client, make_user) -> None:
    _users(make_user)
    _login(client, "owner", "owner-passphrase-1")
    buyer_id = _buyer(client)
    product_id = _product(client)

    created = client.post("/api/v1/tax-invoices", json=_invoice_payload(buyer_id, product_id))
    assert created.status_code == 201
    body = created.json()
    assert body["invoice_number"] == "003"
    assert body["status"] == "DRAFT"
    assert Decimal(str(body["taxable_amount"])) == Decimal("543180.00")
    assert Decimal(str(body["total_tax_amount"])) == Decimal("27159.00")
    assert Decimal(str(body["grand_total"])) == Decimal("570339.00")
    assert (
        body["amount_in_words"]
        == "INR Five Lakhs Seventy Thousand Three Hundred and Thirty Nine Only"
    )
    assert (
        body["tax_amount_in_words"]
        == "INR Twenty Seven Thousand One Hundred and Fifty Nine Only"
    )
    # Buyer snapshotted onto the invoice.
    assert body["buyer_gstin"] == "33BFWPP8062H1ZU"
    # Tax summary aggregates by HSN.
    assert len(body["tax_summary"]) == 1
    assert body["tax_summary"][0]["hsn_sac"] == "23022020"
    assert Decimal(str(body["tax_summary"][0]["gst_amount"])) == Decimal("27159.00")

    # Intra-state supply → GST splits equally into CGST + SGST (no IGST).
    assert body["is_interstate"] is False
    line0 = body["lines"][0]
    assert Decimal(str(line0["cgst_amount"])) == Decimal("13579.50")
    assert Decimal(str(line0["sgst_amount"])) == Decimal("13579.50")
    assert Decimal(str(line0["igst_amount"])) == Decimal("0.00")

    invoice_id = body["id"]

    # Issue locks the invoice and produces the PDF document.
    issued = client.post(f"/api/v1/tax-invoices/{invoice_id}/issue")
    assert issued.status_code == 200
    assert issued.json()["status"] == "ISSUED"
    assert issued.json()["pdf_document_id"] is not None

    # The generated PDF downloads and is a real PDF with exactly 1 page.
    pdf = client.get(f"/api/v1/tax-invoices/{invoice_id}/pdf/download")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:5] == b"%PDF-"
    assert pdf.content.count(b"/Type /Page\n") == 1

    # An issued invoice can no longer be edited.
    edit = client.put(
        f"/api/v1/tax-invoices/{invoice_id}", json=_invoice_payload(buyer_id, product_id)
    )
    assert edit.status_code == 409
    assert edit.json()["error"]["code"] == "invalid_state"


def test_qr_png_is_a_png() -> None:
    """The QR helper emits real PNG bytes (fpdf2 embeds PNG without Pillow)."""
    from app.modules.invoicing.pdf import _qr_png

    data = _qr_png("https://example.com/i?token=abc").getvalue()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"


def test_public_qr_invoice_access(client, make_user) -> None:
    """Anyone with the unguessable token (from the printed QR) can view + download
    the invoice with no login; an unknown token is a 404."""
    _users(make_user)
    _login(client, "owner", "owner-passphrase-1")
    buyer_id = _buyer(client)
    product_id = _product(client)
    detail = client.post(
        "/api/v1/tax-invoices", json=_invoice_payload(buyer_id, product_id)
    ).json()
    token = detail["public_token"]
    assert token

    # Drop the session cookie to prove the public endpoints need no auth.
    client.cookies.clear()

    summary = client.get(f"/api/v1/public/invoices/{token}")
    assert summary.status_code == 200
    body = summary.json()
    assert body["invoice_number"] == "003"
    assert body["buyer_name"] == "Vellaya Gounder Traders"
    assert body["seller_name"]

    pdf = client.get(f"/api/v1/public/invoices/{token}/pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:5] == b"%PDF-"

    # Unknown token → 404, not a data leak.
    assert client.get("/api/v1/public/invoices/not-a-real-token/pdf").status_code == 404


def test_eway_bill_upload(client, make_user) -> None:
    _users(make_user)
    _login(client, "owner", "owner-passphrase-1")
    buyer_id = _buyer(client)
    product_id = _product(client)
    invoice_id = client.post(
        "/api/v1/tax-invoices", json=_invoice_payload(buyer_id, product_id)
    ).json()["id"]

    resp = client.post(
        f"/api/v1/tax-invoices/{invoice_id}/eway-bill",
        files={"file": ("eway.pdf", b"%PDF-1.4 fake eway bill", "application/pdf")},
    )
    assert resp.status_code == 200
    assert resp.json()["document_id"]

    detail = client.get(f"/api/v1/tax-invoices/{invoice_id}").json()
    assert detail["eway_document_id"] is not None


def test_explicit_invoice_number_must_be_unique(client, make_user) -> None:
    _users(make_user)
    _login(client, "owner", "owner-passphrase-1")
    buyer_id = _buyer(client)
    product_id = _product(client)
    client.post("/api/v1/tax-invoices", json=_invoice_payload(buyer_id, product_id))
    dup = client.post("/api/v1/tax-invoices", json=_invoice_payload(buyer_id, product_id))
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "conflict"


def test_delete_buyer_keeps_invoice_snapshot(client, make_user) -> None:
    """Deleting a buyer master must not alter existing invoices/PDFs."""
    _users(make_user)
    _login(client, "owner", "owner-passphrase-1")
    buyer_id = _buyer(client)
    product_id = _product(client)
    invoice_id = client.post(
        "/api/v1/tax-invoices", json=_invoice_payload(buyer_id, product_id)
    ).json()["id"]

    resp = client.delete(f"/api/v1/buyers/{buyer_id}")
    assert resp.status_code == 204
    assert client.get("/api/v1/buyers").json() == []  # gone from the master list

    # The invoice keeps its snapshotted buyer; only the FK link is cleared.
    detail = client.get(f"/api/v1/tax-invoices/{invoice_id}").json()
    assert detail["buyer_name"] == "Vellaya Gounder Traders"
    assert detail["buyer_gstin"] == "33BFWPP8062H1ZU"
    assert detail["buyer_id"] is None
    # And the PDF still renders.
    pdf = client.get(f"/api/v1/tax-invoices/{invoice_id}/pdf/download")
    assert pdf.status_code == 200
    assert pdf.content[:5] == b"%PDF-"


# --------------------------------------------------------------------------- #
# Permissions
# --------------------------------------------------------------------------- #
def test_staff_cannot_manage_masters_or_issue(client, make_user) -> None:
    _users(make_user)
    # Owner sets up the masters + a draft invoice.
    _login(client, "owner", "owner-passphrase-1")
    buyer_id = _buyer(client)
    product_id = _product(client)
    invoice_id = client.post(
        "/api/v1/tax-invoices", json=_invoice_payload(buyer_id, product_id)
    ).json()["id"]

    # Staff may view/create invoices but not manage masters or issue.
    _login(client, "staff", "staff-passphrase-1")
    assert client.post("/api/v1/buyers", json={"name": "X"}).status_code == 403
    assert client.post(f"/api/v1/tax-invoices/{invoice_id}/issue").status_code == 403
    assert client.get("/api/v1/tax-invoices").status_code == 200
