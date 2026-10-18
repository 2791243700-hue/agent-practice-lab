"""Local process supervisor. Tokens live only in the supervisor/child environments."""

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import psutil


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def identity(process):
    process = psutil.Process(process.pid)
    return {"pid": process.pid, "created_at": process.create_time()}


def matches(record, expected=None):
    try:
        process = psutil.Process(record["pid"])
        if abs(process.create_time() - record["created_at"]) > 0.05:
            return False
        if expected and not all(v in process.cmdline() for v in expected):
            return False
        return process.is_running() and process.status() != psutil.STATUS_ZOMBIE
    except (psutil.Error, KeyError, TypeError):
        return False


def free(port):
    try:
        with socket.socket() as sock:
            if os.name == "nt":
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            sock.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def read_record(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def expected(args):
    return ["agent_school.launcher", "run", str(args.root), str(args.data_dir)]


def process_options():
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}


def stop_child(child):
    if not matches(child):
        return
    try:
        parent = psutil.Process(child["pid"])
        targets = parent.children(recursive=True) + [parent]
        for process in reversed(targets):
            try:
                process.terminate()
            except psutil.Error:
                pass
        _, alive = psutil.wait_procs(targets, timeout=3)
        for process in alive:
            try:
                process.kill()
            except psutil.Error:
                pass
    except psutil.Error:
        pass


def run(args):
    runtime = args.data_dir / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    # Exclusive OS lock survives stale PID files and releases automatically after a crash.
    lock = (runtime / "supervisor.lock").open("a+b")
    try:
        if os.name == "nt":
            import msvcrt

            lock.seek(0)
            lock.write(b"0")
            lock.flush()
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 1
    record = {
        "instance_id": args.instance_id or secrets.token_hex(12),
        "state": "starting",
        "root": str(args.root),
        "api_port": args.api_port,
        "web_port": None,
        "supervisor": identity(psutil.Process()),
        "children": [],
    }
    path = runtime / "processes.json"
    children = []
    logs = []
    try:
        if not free(args.api_port):
            raise RuntimeError("API port is occupied; no existing process was stopped.")
        web = args.root / "apps/web"
        use_web = not args.no_web and (web / "package.json").is_file()
        if use_web and (args.web_port == args.api_port or not free(args.web_port)):
            raise RuntimeError("Web port is occupied or matches API port.")
        token = secrets.token_urlsafe(32)
        env = {
            **os.environ,
            "AGENT_SCHOOL_LOCAL_TOKEN": token,
            "AGENT_SCHOOL_DATA": str(args.data_dir),
            "AGENT_SCHOOL_FRONTEND_ORIGIN": f"http://127.0.0.1:{args.web_port}",
            "AGENT_SCHOOL_API_ORIGIN": f"http://127.0.0.1:{args.api_port}",
            "AGENT_SCHOOL_DEMO": "1" if args.demo else "0",
            "PYTHONUTF8": "1",
        }
        commands = [
            (
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "agent_school.main:app_factory",
                    "--factory",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(args.api_port),
                    "--workers",
                    "1",
                    "--no-access-log",
                ],
                args.root / "apps/api",
                "api",
            )
        ]
        if use_web:
            node = shutil.which("node")
            if not node:
                raise RuntimeError("Node.js is required for the frontend.")
            npm = Path(node).parent / "node_modules/npm/bin/npm-cli.js"
            if not npm.is_file():
                raise RuntimeError("npm CLI not found beside Node.js.")
            commands.append(
                (
                    [
                        node,
                        str(npm),
                        "run",
                        "dev",
                        "--",
                        "--hostname",
                        "127.0.0.1",
                        "--port",
                        str(args.web_port),
                    ],
                    web,
                    "web",
                )
            )
            record["web_port"] = args.web_port
        for command, cwd, name in commands:
            stdout = (runtime / (name + ".log")).open("ab")
            logs.append(stdout)
            child = subprocess.Popen(
                command,
                cwd=cwd,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=stdout,
                stderr=subprocess.STDOUT,
                **process_options(),
            )
            children.append(identity(child))
        record["children"] = children
        write_json(path, record)
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            if not all(matches(child) for child in children):
                raise RuntimeError("A child process exited; inspect runtime logs.")
            try:
                request = urllib.request.Request(
                    f"http://127.0.0.1:{args.api_port}/api/v1/health", headers={"X-Local-Token": token}
                )
                with urllib.request.urlopen(request, timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("Backend did not become ready; inspect api.log.")
        record["state"] = "ready"
        write_json(path, record)
        while all(matches(child) for child in children):
            stop = read_record(runtime / "stop.json")
            if stop and stop.get("instance_id") == record["instance_id"]:
                break
            time.sleep(0.15)
        record["state"] = "stopped"
    except Exception as error:
        record.update(state="failed", message=str(error))
    finally:
        for child in reversed(children):
            stop_child(child)
        write_json(path, record)
        for log in logs:
            log.close()
        lock.close()
    return 0 if record["state"] == "stopped" else 1


def start(args):
    runtime = args.data_dir / "runtime"
    path = runtime / "processes.json"
    old = read_record(path)
    if old and matches(old.get("supervisor", {}), expected(args)):
        print("This project is already running.")
        return 1
    if not free(args.api_port):
        print("API port is occupied; choose another port.")
        return 1
    runtime.mkdir(parents=True, exist_ok=True)
    instance_id = secrets.token_hex(12)
    command = [
        sys.executable,
        "-m",
        "agent_school.launcher",
        "run",
        "--instance-id",
        instance_id,
        "--root",
        str(args.root),
        "--data-dir",
        str(args.data_dir),
        "--api-port",
        str(args.api_port),
        "--web-port",
        str(args.web_port),
    ]
    if args.no_web:
        command.append("--no-web")
    if args.demo:
        command.append("--demo")
    with (runtime / "supervisor.log").open("ab") as log:
        child = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            env={**os.environ, "PYTHONUTF8": "1"},
            **process_options(),
        )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        record = read_record(path)
        if (
            record
            and record.get("instance_id") == instance_id
            and matches(record.get("supervisor", {}), expected(args))
        ):
            if record["state"] == "ready":
                print(f"Backend ready at http://127.0.0.1:{args.api_port} (private local token required).")
                if record["web_port"]:
                    print(f"Open http://127.0.0.1:{record['web_port']}")
                else:
                    print("Frontend not started. See docs/backend.md for integration.")
                return 0
            if record["state"] == "failed":
                print(record.get("message", "Startup failed."))
                return 1
        if child.poll() is not None:
            print("Supervisor exited; inspect supervisor.log.")
            return 1
        time.sleep(0.1)
    stop_child(identity(child))
    print("Startup timed out; supervisor stopped.")
    return 1


def stop(args):
    runtime = args.data_dir / "runtime"
    record = read_record(runtime / "processes.json")
    if not record or not matches(record.get("supervisor", {}), expected(args)):
        print("No matching project process is running.")
        return 0
    write_json(runtime / "stop.json", {"instance_id": record["instance_id"]})
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        if not matches(record["supervisor"], expected(args)):
            print("Project processes stopped.")
            return 0
        time.sleep(0.1)
    print("Supervisor did not stop; no unrelated process was terminated.")
    return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "stop", "run"])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--api-port", type=int, default=8000)
    parser.add_argument("--web-port", type=int, default=3000)
    parser.add_argument("--no-web", action="store_true")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--instance-id", default=None, help=argparse.SUPPRESS)
    args = parser.parse_args()
    args.root = args.root.resolve()
    args.data_dir = (args.data_dir or args.root / "data").absolute()
    if not 1 <= args.api_port <= 65535 or not 1 <= args.web_port <= 65535:
        parser.error("Ports must be between 1 and 65535")
    return {"start": start, "stop": stop, "run": run}[args.action](args)


if __name__ == "__main__":
    raise SystemExit(main())
