import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    root: Path
    data_dir: Path
    local_token: str = field(repr=False)
    frontend_origin: str = "http://127.0.0.1:3000"
    demo_enabled: bool = False
    execution_timeout: float = 120.0
    approval_timeout: float = 600.0
    reset_timeout: float = 10.0

    def __post_init__(self):
        self.root = self.root.resolve()
        self.data_dir = self.data_dir.absolute()
        if len(self.local_token) < 16:
            raise ValueError("LOCAL_TOKEN must contain at least 16 characters")

    @classmethod
    def from_env(cls):
        root = Path(__file__).resolve().parents[4]
        return cls(
            root=root,
            data_dir=Path(os.environ.get("AGENT_SCHOOL_DATA", root / "data")),
            local_token=os.environ.get("AGENT_SCHOOL_LOCAL_TOKEN", ""),
            frontend_origin=os.environ.get("AGENT_SCHOOL_FRONTEND_ORIGIN", "http://127.0.0.1:3000"),
            demo_enabled=os.environ.get("AGENT_SCHOOL_DEMO", "0") == "1",
        )
