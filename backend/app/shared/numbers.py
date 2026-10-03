"""Number-to-words for Indian currency amounts (Lakh/Crore grouping).

Used to render the "Amount Chargeable (in words)" and "Tax amount (in words)"
lines on the GST tax invoice. Dependency-free and Decimal-based (never float).

Style matches the Indian convention seen on Tally-style invoices, e.g.
``indian_amount_in_words(Decimal("570339")) ==
"INR Five Lakhs Seventy Thousand Three Hundred and Thirty Nine Only"``.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import NamedTuple

_ONES = (
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
)
_TENS = (
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
)


def _two_digits(n: int) -> str:
    """Words for 0-99 (empty string for 0)."""
    if n == 0:
        return ""
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    return _TENS[tens] + (f" {_ONES[ones]}" if ones else "")


def _number_words(n: int) -> str:
    """Words for a non-negative integer using Indian grouping."""
    if n == 0:
        return "Zero"
    crore = n // 10_000_000
    lakh = (n // 100_000) % 100
    thousand = (n // 1000) % 100
    hundred = (n // 100) % 10
    last = n % 100

    parts: list[str] = []
    if crore:
        parts.append(f"{_two_digits(crore)} Crore" + ("s" if crore > 1 else ""))
    if lakh:
        parts.append(f"{_two_digits(lakh)} Lakh" + ("s" if lakh > 1 else ""))
    if thousand:
        parts.append(f"{_two_digits(thousand)} Thousand")
    if hundred:
        parts.append(f"{_ONES[hundred]} Hundred")
    if last:
        # "and" links the final sub-hundred group to any larger group before it,
        # e.g. "Three Hundred and Thirty Nine".
        parts.append(("and " if parts else "") + _two_digits(last))
    return " ".join(parts)


class GstComponents(NamedTuple):
    """A line's GST split into CGST/SGST (intra-state) or IGST (inter-state).

    Exactly one pair is non-zero for a given supply: intra-state fills
    CGST + SGST, inter-state fills IGST. Amounts always sum back to the line's
    total GST.
    """

    cgst_rate: Decimal
    cgst_amount: Decimal
    sgst_rate: Decimal
    sgst_amount: Decimal
    igst_rate: Decimal
    igst_amount: Decimal


def is_interstate(seller_state_code: str | None, buyer_state_code: str | None) -> bool:
    """True when seller and buyer are in different states (→ IGST).

    Missing codes default to intra-state (CGST + SGST), the common case.
    """
    if not seller_state_code or not buyer_state_code:
        return False
    return seller_state_code.strip() != buyer_state_code.strip()


def gst_components(rate: Decimal, amount: Decimal, *, interstate: bool) -> GstComponents:
    """Break a line's GST rate/amount into CGST+SGST or IGST.

    Inter-state → the full rate/amount as IGST. Intra-state → equal CGST and SGST
    halves; any odd paisa goes to CGST so the two halves sum back to ``amount``.
    """
    zero = Decimal("0")
    if interstate:
        return GstComponents(zero, zero, zero, zero, rate, amount)
    half_rate = (rate / Decimal(2)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    cgst_amount = (amount / Decimal(2)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sgst_amount = amount - cgst_amount
    return GstComponents(half_rate, cgst_amount, half_rate, sgst_amount, zero, zero)


def indian_amount_in_words(amount: Decimal, currency: str = "INR") -> str:
    """Render ``amount`` as words prefixed by the currency code.

    Rupees use Indian grouping; any paise are appended as "and N Paise".
    """
    quantized = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    rupees = int(quantized)
    paise = int((quantized - rupees) * 100)
    words = _number_words(rupees)
    result = f"{currency} {words}".strip()
    if paise > 0:
        result += f" and {_number_words(paise)} Paise"
    return f"{result} Only"
