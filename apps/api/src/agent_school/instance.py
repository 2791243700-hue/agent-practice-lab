import os
from pathlib import Path


class InstanceLock:
    """Keep the in-process scheduler exclusive for a given local data directory."""

    def __init__(self, directory):
        directory = Path(directory)
        if directory.is_symlink() or (hasattr(directory, "is_junction") and directory.is_junction()):
            raise RuntimeError("Linked data directory is not allowed")
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / "backend.lock"
        if target.is_symlink():
            raise RuntimeError("Linked lock file is not allowed")
        self.file = target.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt

                if self.file.seek(0, 2) == 0:
                    self.file.write(b"0")
                    self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise RuntimeError("Backend already running for this data directory") from None

    def close(self):
        if not self.file.closed:
            self.file.close()
