"""add tax_invoices public_token

Revision ID: a1c2e3f4b5d6
Revises: 5f27da3e5ef0
Create Date: 2026-09-22 00:00:00.000000+00:00
"""

from __future__ import annotations

import secrets
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c2e3f4b5d6"
down_revision: str | None = "5f27da3e5ef0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add nullable so existing rows can be backfilled first.
    op.add_column("tax_invoices", sa.Column("public_token", sa.String(length=64), nullable=True))

    # 2. Backfill each existing invoice with its own unguessable token.
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id FROM tax_invoices WHERE public_token IS NULL")
    ).fetchall()
    for (row_id,) in rows:
        conn.execute(
            sa.text("UPDATE tax_invoices SET public_token = :tok WHERE id = :id"),
            {"tok": secrets.token_urlsafe(32), "id": row_id},
        )

    # 3. Enforce not-null + a unique index (matches the model: unique + indexed).
    op.alter_column("tax_invoices", "public_token", existing_type=sa.String(length=64), nullable=False)
    op.create_index(
        "ix_tax_invoices_public_token", "tax_invoices", ["public_token"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_tax_invoices_public_token", table_name="tax_invoices")
    op.drop_column("tax_invoices", "public_token")
