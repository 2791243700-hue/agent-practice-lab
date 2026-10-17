"""Initial local records and event schema."""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = depends_on = None

def upgrade():
    op.create_table("records",
        sa.Column("kind",sa.String(),primary_key=True),sa.Column("id",sa.String(),primary_key=True),
        sa.Column("owner_id",sa.String(),nullable=False),sa.Column("data",sa.JSON(),nullable=False))
    op.create_index("ix_records_owner_id","records",["owner_id"])
    op.create_table("events",
        sa.Column("run_id",sa.String(),primary_key=True),sa.Column("seq",sa.Integer(),primary_key=True),
        sa.Column("owner_id",sa.String(),nullable=False),sa.Column("data",sa.JSON(),nullable=False))

def downgrade():
    op.drop_table("events")
    op.drop_index("ix_records_owner_id",table_name="records")
    op.drop_table("records")

