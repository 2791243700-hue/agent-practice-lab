from alembic import context
from sqlalchemy import create_engine
from agent_school.models import metadata


def migrate(connection):
    context.configure(connection=connection, target_metadata=metadata)
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    migrate(connection)
else:
    from pathlib import Path
    import os

    data = Path(os.environ.get("AGENT_SCHOOL_DATA", Path(__file__).resolve().parents[3] / "data"))
    data.mkdir(parents=True, exist_ok=True)
    engine = create_engine("sqlite:///" + str(data / "school.sqlite3"))
    with engine.begin() as connection:
        migrate(connection)
