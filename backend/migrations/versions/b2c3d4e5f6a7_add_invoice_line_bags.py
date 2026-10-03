"""add bags column to tax_invoice_lines

Revision ID: b2c3d4e5f6a7
Revises: a1c2e3f4b5d6
Create Date: 2026-10-03 00:00:00.000000+00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1c2e3f4b5d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tax_invoice_lines", sa.Column("bags", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "bags_non_negative",
        "tax_invoice_lines",
        "bags IS NULL OR bags >= 0",
    )


def downgrade() -> None:
    op.drop_constraint("bags_non_negative", "tax_invoice_lines", type_="check")
    op.drop_column("tax_invoice_lines", "bags")
