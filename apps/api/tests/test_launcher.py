import json
import socket
import subprocess
import sys
from pathlib import Path

from agent_school.launcher import matches


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def invoke(root, data, action, port=None):
    args = [
        sys.executable,
        "-m",
        "agent_school.launcher",
        action,
        "--root",
        str(root),
        "--data-dir",
        str(data),
    ]
    if port:
        args += ["--api-port", str(port), "--web-port", str(free_port()), "--no-web"]
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=40, check=False)


def test_launcher_handles_spaces_duplicate_start_stop_and_foreign_port(tmp_path):
    root = Path(__file__).resolve().parents[3]
    data = tmp_path / "中文 space"
    port = free_port()
    first = invoke(root, data, "start", port)
    assert first.returncode == 0, first.stdout + first.stderr
    try:
        record = json.loads((data / "runtime/processes.json").read_text())
        assert record["api_port"] == port
        assert "token" not in json.dumps(record).lower()
        duplicate = invoke(root, data, "start", port)
        assert duplicate.returncode != 0
        assert (
            json.loads((data / "runtime/processes.json").read_text())["supervisor"]["pid"]
            == record["supervisor"]["pid"]
        )
    finally:
        stopped = invoke(root, data, "stop")
        assert stopped.returncode == 0, stopped.stdout + stopped.stderr
    assert not matches(record["supervisor"])
    assert all(not matches(child) for child in record["children"])
    with socket.socket() as sock:
        # A closed server port may remain in TIME_WAIT on Linux. The foreign
        # service check is independent of the stopped process's former port.
        sock.bind(("127.0.0.1", 0))
        sock.listen()
        foreign_port = sock.getsockname()[1]
        blocked = invoke(root, tmp_path / "occupied", "start", foreign_port)
        assert blocked.returncode != 0
        # The application must not kill the process owning another service's port.
        assert sock.getsockname()[1] == foreign_port
