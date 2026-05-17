#!/usr/bin/env python3
"""Minimal stdio MCP server for local Codex trading-agents-workflow control-plane reads."""

from __future__ import annotations

import datetime as dt
import json
import os
import shlex
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any


SERVER_NAME = "trading-agents-workflow"
SERVER_VERSION = "0.1.0"

DEFAULT_LOCAL_REPO = str(Path(__file__).resolve().parents[1])
DEFAULT_REMOTE_PATH = "/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow"
DEFAULT_REMOTE_HOST = "106.54.53.146"
DEFAULT_REMOTE_USER = "flashcat"
DEFAULT_REMOTE_KEY = "/Users/Flashcat/.ssh/openclaw_server"
DEFAULT_AUDIT_LOG = "/Users/Flashcat/.trading-agents-workflow-mcp/audit.jsonl"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def audit(event: dict[str, Any]) -> None:
    try:
        path = Path(os.environ.get("TRADING_WORKFLOW_MCP_AUDIT_LOG", DEFAULT_AUDIT_LOG)).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        event.setdefault("ts", now_iso())
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    except OSError:
        # Tool results must not fail just because the local audit sink is unavailable.
        return


def local_repo() -> Path:
    return Path(os.environ.get("TRADING_WORKFLOW_LOCAL_REPO", DEFAULT_LOCAL_REPO)).expanduser()


def remote_path() -> str:
    return os.environ.get("TRADING_WORKFLOW_REMOTE_PATH", DEFAULT_REMOTE_PATH)


def run(cmd: list[str], cwd: Path | None = None, timeout: int = 30) -> dict[str, Any]:
    proc = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
        check=False,
    )
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": (proc.stdout or "").strip(),
        "stderr": (proc.stderr or "").strip(),
    }


def run_remote(script: str, timeout: int = 30) -> dict[str, Any]:
    host = os.environ.get("TRADING_WORKFLOW_REMOTE_HOST", DEFAULT_REMOTE_HOST)
    user = os.environ.get("TRADING_WORKFLOW_REMOTE_USER", DEFAULT_REMOTE_USER)
    key = os.environ.get("TRADING_WORKFLOW_REMOTE_KEY", DEFAULT_REMOTE_KEY)
    cmd = [
        "ssh",
        "-tt",
        "-i",
        key,
        "-o",
        "BatchMode=yes",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=2",
        f"{user}@{host}",
        script,
    ]
    return run(cmd, timeout=max(timeout, 30))


def git_status(args: dict[str, Any]) -> dict[str, Any]:
    repo = local_repo()
    status = run(["git", "status", "--short", "--branch"], cwd=repo)
    head = run(["git", "rev-parse", "HEAD"], cwd=repo)
    remote = run(["git", "remote", "-v"], cwd=repo)
    tracked = run(["git", "ls-files"], cwd=repo)
    payload = {
        "local_repo": str(repo),
        "exists": repo.exists(),
        "git_status": status,
        "head": head.get("stdout"),
        "remote": remote.get("stdout"),
        "tracked_file_count": len(tracked.get("stdout", "").splitlines()) if tracked.get("ok") else None,
    }
    audit({"event": "git_status", **payload})
    return payload


def server_snapshot(args: dict[str, Any]) -> dict[str, Any]:
    path = remote_path()
    max_files = max(1, min(int(args.get("max_files") or 120), 500))
    script = (
        "set -e; "
        f"cd {shlex.quote(path)}; "
        "printf 'PWD=%s\\n' \"$PWD\"; "
        "printf 'SIZE='; du -sh . | awk '{print $1}'; "
        f"find . -maxdepth 4 -type f -not -path './.git/*' | sort | head -{max_files}"
    )
    result = run_remote(script, timeout=30)
    payload = {"remote_path": path, "max_files": max_files, "remote": result}
    audit({"event": "server_snapshot", "ok": result.get("ok"), "remote_path": path})
    return payload


def latest_jsonl(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    relative_path = str(args.get("path") or "governance-logs/main-heartbeat-readiness.jsonl").strip()
    limit = max(1, min(int(args.get("limit") or 20), 200))
    if relative_path.startswith("/") or ".." in Path(relative_path).parts:
        raise ValueError("path must be a safe relative path")

    if source == "remote":
        full = f"{remote_path().rstrip('/')}/{relative_path}"
        result = run_remote(f"test -f {shlex.quote(full)} && tail -n {limit} {shlex.quote(full)}", timeout=30)
        lines = result.get("stdout", "").splitlines() if result.get("ok") else []
        payload = {"source": source, "path": relative_path, "limit": limit, "lines": lines, "remote": result}
    elif source == "local":
        full_path = local_repo() / relative_path
        if not full_path.exists():
            lines = []
        else:
            lines = full_path.read_text(encoding="utf-8").splitlines()[-limit:]
        payload = {"source": source, "path": relative_path, "limit": limit, "lines": lines}
    else:
        raise ValueError("source must be local or remote")
    audit({"event": "latest_jsonl", "source": source, "path": relative_path, "count": len(lines)})
    return payload


def runtime_agents(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    runtime_filter = str(args.get("runtime") or "").strip()
    limit = max(1, min(int(args.get("limit") or 100), 500))
    query = (
        "select agent_id, runtime, display_name, role, status, endpoint_ref, updated_at "
        "from runtime_agents"
    )
    params: list[Any] = []
    if runtime_filter:
        query += " where runtime = ?"
        params.append(runtime_filter)
    query += " order by runtime, agent_id limit ?"
    params.append(limit)

    if source == "local":
        db = local_repo() / "tracking.db"
        if not db.exists():
            return {"source": source, "database": str(db), "exists": False, "agents": []}
        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        try:
            agents = [dict(row) for row in conn.execute(query, params).fetchall()]
        finally:
            conn.close()
        payload = {"source": source, "database": str(db), "exists": True, "agents": agents}
    elif source == "remote":
        sql_runtime = "'" + runtime_filter.replace("'", "''") + "'"
        where = f" where runtime = {sql_runtime}" if runtime_filter else ""
        remote_query = (
            ".mode json\n"
            f"select agent_id, runtime, display_name, role, status, endpoint_ref, updated_at "
            f"from runtime_agents{where} order by runtime, agent_id limit {limit};\n"
        )
        db_path = f"{remote_path().rstrip('/')}/tracking.db"
        script = f"printf %s {shlex.quote(remote_query)} | sqlite3 {shlex.quote(db_path)}"
        result = run_remote(script, timeout=30)
        try:
            agents = json.loads(result.get("stdout") or "[]") if result.get("ok") else []
        except json.JSONDecodeError:
            agents = []
        payload = {"source": source, "database": db_path, "remote": result, "agents": agents}
    else:
        raise ValueError("source must be local or remote")
    audit({"event": "runtime_agents", "source": source, "count": len(payload.get("agents", []))})
    return payload


TOOLS: dict[str, dict[str, Any]] = {
    "workflow_git_status": {
        "description": "Return local Git status for the trading-agents-workflow repository.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    "workflow_server_snapshot": {
        "description": "Read-only snapshot of the development-server trading-agents-workflow directory.",
        "inputSchema": {
            "type": "object",
            "properties": {"max_files": {"type": "number"}},
            "additionalProperties": False,
        },
    },
    "workflow_latest_jsonl": {
        "description": "Read the latest lines from a safe relative JSONL file in the workflow tree.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "path": {"type": "string"},
                "limit": {"type": "number"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_runtime_agents": {
        "description": "Query the runtime_agents registry from local or remote tracking.db.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "runtime": {"type": "string"},
                "limit": {"type": "number"},
            },
            "additionalProperties": False,
        },
    },
}


def tool_result(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
        "structuredContent": payload,
    }


def error_response(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def handle_request(req: dict[str, Any]) -> dict[str, Any] | None:
    req_id = req.get("id")
    method = req.get("method")
    params = req.get("params") or {}

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": params.get("protocolVersion") or "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
        }
    if method == "notifications/initialized":
        return None
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": [{"name": n, **s} for n, s in TOOLS.items()]}}
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        try:
            if name == "workflow_git_status":
                payload = git_status(arguments)
            elif name == "workflow_server_snapshot":
                payload = server_snapshot(arguments)
            elif name == "workflow_latest_jsonl":
                payload = latest_jsonl(arguments)
            elif name == "workflow_runtime_agents":
                payload = runtime_agents(arguments)
            else:
                raise ValueError(f"unknown tool: {name}")
            return {"jsonrpc": "2.0", "id": req_id, "result": tool_result(payload)}
        except Exception as exc:
            audit({"event": "tool_error", "tool": name, "error": str(exc)})
            return error_response(req_id, -32000, str(exc))
    if method and method.startswith("notifications/"):
        return None
    return error_response(req_id, -32601, f"method not found: {method}")


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            response = handle_request(json.loads(line))
        except Exception as exc:
            response = error_response(None, -32700, str(exc))
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
