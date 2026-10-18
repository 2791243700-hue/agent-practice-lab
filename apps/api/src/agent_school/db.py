import copy
import threading
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, delete, event, insert, select, update

from agent_school.errors import not_found
from agent_school.models import events, records


class Store:
    """Small local repository with versioned JSON documents and normalized event keys."""

    def __init__(self, data_dir):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            "sqlite:///" + str(self.data_dir / "school.sqlite3"),
            connect_args={"check_same_thread": False, "timeout": 10},
        )

        @event.listens_for(self.engine, "connect")
        def configure(dbapi, _):
            dbapi.execute("PRAGMA foreign_keys=ON")
            dbapi.execute("PRAGMA journal_mode=WAL")

        cfg = AlembicConfig()
        cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
        with self.engine.begin() as connection:
            cfg.attributes["connection"] = connection
            command.upgrade(cfg, "head")
        self.lock = threading.RLock()
        self.local = threading.local()

    @contextmanager
    def atomic(self):
        with self.lock:
            if getattr(self.local, "connection", None) is not None:
                yield self.local.connection
            else:
                with self.engine.begin() as connection:
                    self.local.connection = connection
                    try:
                        yield connection
                    finally:
                        self.local.connection = None

    def get(self, kind, key, owner="local-owner", missing_ok=False):
        with self.atomic() as connection:
            row = connection.execute(
                select(records.c.data).where(
                    records.c.kind == kind, records.c.id == key, records.c.owner_id == owner
                )
            ).first()
        if row is None:
            if missing_ok:
                return None
            not_found()
        return copy.deepcopy(row[0])

    def put(self, kind, key, value, owner="local-owner"):
        with self.atomic() as connection:
            row = connection.execute(
                select(records.c.owner_id).where(records.c.kind == kind, records.c.id == key)
            ).first()
            if row:
                if row[0] != owner:
                    not_found()
                connection.execute(
                    update(records).where(records.c.kind == kind, records.c.id == key).values(data=value)
                )
            else:
                connection.execute(insert(records).values(kind=kind, id=key, owner_id=owner, data=value))
        return value

    def remove(self, kind, key, owner="local-owner"):
        self.get(kind, key, owner)
        with self.atomic() as connection:
            connection.execute(
                delete(records).where(
                    records.c.kind == kind, records.c.id == key, records.c.owner_id == owner
                )
            )

    def list(self, kind, owner="local-owner"):
        with self.atomic() as connection:
            rows = connection.execute(
                select(records.c.data).where(records.c.kind == kind, records.c.owner_id == owner)
            ).all()
        return copy.deepcopy([r[0] for r in rows])

    def append_event(self, run_id, value, owner="local-owner"):
        with self.atomic() as connection:
            run = self.get("run", run_id, owner)
            seq = run["last_seq"] + 1
            value = {**value, "seq": seq}
            connection.execute(insert(events).values(run_id=run_id, seq=seq, owner_id=owner, data=value))
            run["last_seq"] = seq
            self.put("run", run_id, run, owner)
        return value

    def event_list(self, run_id, owner="local-owner"):
        self.get("run", run_id, owner)
        with self.atomic() as connection:
            rows = connection.execute(
                select(events.c.data)
                .where(events.c.run_id == run_id, events.c.owner_id == owner)
                .order_by(events.c.seq)
            ).all()
        return copy.deepcopy([row[0] for row in rows])

    def close(self):
        self.engine.dispose()
