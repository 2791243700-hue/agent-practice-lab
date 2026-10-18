from sqlalchemy import JSON, Column, Integer, MetaData, String, Table

metadata = MetaData()
records = Table(
    "records",
    metadata,
    Column("kind", String, primary_key=True),
    Column("id", String, primary_key=True),
    Column("owner_id", String, nullable=False, index=True),
    Column("data", JSON, nullable=False),
)
events = Table(
    "events",
    metadata,
    Column("run_id", String, primary_key=True),
    Column("seq", Integer, primary_key=True),
    Column("owner_id", String, nullable=False),
    Column("data", JSON, nullable=False),
)
