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
SERVER_VERSION = "0.1.1"

DEFAULT_LOCAL_REPO = str(Path(__file__).resolve().parents[1])
DEFAULT_REMOTE_STATE_ROOT = "/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow"
DEFAULT_REMOTE_CODE_PATH = "/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout"
DEFAULT_REMOTE_PATH = DEFAULT_REMOTE_STATE_ROOT
DEFAULT_REMOTE_HOST = "dev-server"
DEFAULT_REMOTE_FALLBACK_HOSTS = ("106.54.53.146",)
DEFAULT_REMOTE_USER = "flashcat"
DEFAULT_REMOTE_KEY = "/Users/Flashcat/.ssh/openclaw_server"
DEFAULT_AUDIT_LOG = "/Users/Flashcat/.trading-agents-workflow-mcp/audit.jsonl"
LEGACY_WORKFLOW_ROOT = Path("/home/flashcat/.openclaw/shared/trading-agents-workflow")
ALLOW_LEGACY_ROOT_ENV = "TRADING_AGENTS_WORKFLOW_ALLOW_LEGACY_ROOT"
MESSAGE_FLOW_DELIVERY_RETURN_POLICIES = ("reply_to_source_chat", "report_to_flashcat")
WORKFLOW_CONTROL_PLANE_DB = "workflow_control_plane.db"
LEGACY_TRACKING_DB = "tracking.db"


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


def env_first(names: tuple[str, ...], default: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return default


def env_first_or_none(names: tuple[str, ...]) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def truthy_env(name: str) -> bool:
    value = os.environ.get(name)
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def normalized_root(value: str | Path) -> str:
    text = str(value).strip()
    if text.startswith("~/"):
        text = str(Path.home() / text[2:])
    return os.path.normpath(text)


def guard_workflow_root(value: str | Path) -> str:
    root = normalized_root(value)
    if root == normalized_root(LEGACY_WORKFLOW_ROOT) and not truthy_env(ALLOW_LEGACY_ROOT_ENV):
        raise ValueError(
            f"legacy trading-agents-workflow root has retired and is fail-closed: {LEGACY_WORKFLOW_ROOT}; "
            "set TRADING_AGENTS_WORKFLOW_ROOT or pass an active workflow_root"
        )
    return root


def local_code_path() -> Path:
    return Path(
        env_first(
            ("TRADING_WORKFLOW_LOCAL_CODE_PATH", "TRADING_WORKFLOW_LOCAL_REPO"),
            DEFAULT_LOCAL_REPO,
        )
    ).expanduser()


def local_state_root() -> Path:
    root = env_first_or_none(
        (
            "TRADING_AGENTS_WORKFLOW_ROOT",
            "TRADING_WORKFLOW_LOCAL_STATE_ROOT",
            "TRADING_WORKFLOW_LOCAL_ROOT",
        )
    )
    if not root:
        raise ValueError("local workflow state root is not configured; set TRADING_AGENTS_WORKFLOW_ROOT or TRADING_WORKFLOW_LOCAL_STATE_ROOT")
    return Path(guard_workflow_root(root))


def local_mutation_state_root(args: dict[str, Any]) -> str:
    explicit = args.get("workflow_root") or args.get("workflowRoot")
    if explicit:
        return guard_workflow_root(str(explicit))
    configured = env_first_or_none(("TRADING_AGENTS_WORKFLOW_ROOT", "TRADING_WORKFLOW_LOCAL_STATE_ROOT", "TRADING_WORKFLOW_LOCAL_ROOT"))
    if configured:
        return guard_workflow_root(configured)
    raise ValueError("workflow_root or TRADING_AGENTS_WORKFLOW_ROOT is required for local mutating workflow tools")


def remote_mutation_state_root(args: dict[str, Any]) -> str:
    explicit = args.get("workflow_root") or args.get("workflowRoot")
    return guard_workflow_root(str(explicit or remote_state_root()))


def local_repo() -> Path:
    return local_code_path()


def remote_code_path() -> str:
    return env_first(("TRADING_WORKFLOW_REMOTE_CODE_PATH", "TRADING_WORKFLOW_REMOTE_REPO"), DEFAULT_REMOTE_CODE_PATH)


def remote_state_root() -> str:
    return guard_workflow_root(
        env_first(
            ("TRADING_WORKFLOW_REMOTE_STATE_ROOT", "TRADING_WORKFLOW_REMOTE_ROOT", "TRADING_WORKFLOW_REMOTE_PATH"),
            DEFAULT_REMOTE_STATE_ROOT,
        )
    )


def remote_path() -> str:
    return remote_state_root()


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


def split_hosts(value: str | None) -> list[str]:
    if not value:
        return []
    hosts: list[str] = []
    for item in value.replace(",", " ").split():
        host = item.strip()
        if host:
            hosts.append(host)
    return hosts


def remote_hosts() -> list[str]:
    primary = os.environ.get("TRADING_WORKFLOW_REMOTE_HOST", DEFAULT_REMOTE_HOST)
    fallback_env = os.environ.get("TRADING_WORKFLOW_REMOTE_FALLBACK_HOSTS")
    fallback_hosts = split_hosts(fallback_env) if fallback_env is not None else list(DEFAULT_REMOTE_FALLBACK_HOSTS)
    hosts: list[str] = []
    for host in [primary, *fallback_hosts]:
        if host and host not in hosts:
            hosts.append(host)
    return hosts


def run_remote(script: str, timeout: int = 30, allow_fallback: bool = True) -> dict[str, Any]:
    user = os.environ.get("TRADING_WORKFLOW_REMOTE_USER", DEFAULT_REMOTE_USER)
    key = os.environ.get("TRADING_WORKFLOW_REMOTE_KEY", DEFAULT_REMOTE_KEY)
    hosts = remote_hosts()
    if not allow_fallback:
        hosts = hosts[:1]
    attempts = []
    last_result: dict[str, Any] | None = None
    for host in hosts:
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
        result = run(cmd, timeout=max(timeout, 30))
        result["remote_host"] = host
        attempts.append(
            {
                "host": host,
                "ok": result.get("ok"),
                "returncode": result.get("returncode"),
                "stderr": str(result.get("stderr") or "")[:500],
            }
        )
        result["attempts"] = attempts
        if result.get("ok") or result.get("returncode") != 255:
            return result
        last_result = result
    return last_result or {"ok": False, "returncode": 255, "stdout": "", "stderr": "no remote hosts configured", "attempts": attempts}


def as_str_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def workflow_db_path(source: str) -> str:
    if source == "local":
        return str(workflow_db_file(local_state_root()))
    return f"{remote_state_root().rstrip('/')}/{WORKFLOW_CONTROL_PLANE_DB}"


def workflow_db_file(root: str | Path) -> Path:
    state = Path(root)
    primary = state / WORKFLOW_CONTROL_PLANE_DB
    legacy = state / LEGACY_TRACKING_DB
    if primary.exists():
        return primary
    if legacy.exists():
        return legacy
    return primary


def db_query(source: str, query: str, params: list[Any] | None = None, timeout: int = 30) -> dict[str, Any]:
    params = params or []
    if source == "local":
        db = Path(workflow_db_path(source))
        if not db.exists():
            return {"ok": False, "database": str(db), "exists": False, "rows": [], "error": "database not found"}
        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        try:
            rows = [dict(row) for row in conn.execute(query, params).fetchall()]
            return {"ok": True, "database": str(db), "exists": True, "rows": rows}
        except Exception as exc:
            return {"ok": False, "database": str(db), "exists": True, "rows": [], "error": f"{type(exc).__name__}: {exc}"}
        finally:
            conn.close()
    if source == "remote":
        payload = json.dumps({"db": workflow_db_path(source), "query": query, "params": params}, ensure_ascii=False)
        code = (
            "import json,sqlite3,sys;"
            "p=json.loads(sys.stdin.read());"
            "c=sqlite3.connect(p['db']);"
            "c.row_factory=sqlite3.Row;"
            "rows=[dict(r) for r in c.execute(p['query'], p.get('params') or []).fetchall()];"
            "c.close();"
            "print(json.dumps(rows, ensure_ascii=False))"
        )
        result = run_remote(f"printf %s {shlex.quote(payload)} | python3 -c {shlex.quote(code)}", timeout=timeout)
        try:
            rows = json.loads(result.get("stdout") or "[]") if result.get("ok") else []
        except json.JSONDecodeError:
            rows = []
        return {"ok": result.get("ok"), "database": workflow_db_path(source), "exists": True, "rows": rows, "remote": result}
    raise ValueError("source must be local or remote")


def table_columns(source: str, table: str) -> list[str]:
    if not table.replace("_", "").isalnum():
        raise ValueError("unsafe table name")
    result = db_query(source, f"PRAGMA table_info({table})")
    return [str(row.get("name")) for row in result.get("rows", []) if row.get("name")]


def select_table(
    source: str,
    table: str,
    desired_columns: list[str],
    filters: dict[str, Any] | None = None,
    contains: dict[str, str] | None = None,
    order_columns: list[str] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    columns = table_columns(source, table)
    if not columns:
        return {"table": table, "exists": False, "columns": [], "rows": []}
    selected = [col for col in desired_columns if col in columns] or columns
    where = []
    params: list[Any] = []
    for col, value in (filters or {}).items():
        if value in (None, "") or col not in columns:
            continue
        where.append(f"{col} = ?")
        params.append(value)
    for col, value in (contains or {}).items():
        if value in (None, "") or col not in columns:
            continue
        where.append(f"{col} LIKE ?")
        params.append(f"%{value}%")
    order = ""
    for col in order_columns or []:
        if col in columns:
            order = f" ORDER BY {col} DESC"
            break
    safe_limit = max(1, min(int(limit), 500))
    query = f"SELECT {', '.join(selected)} FROM {table}"
    if where:
        query += " WHERE " + " AND ".join(where)
    query += f"{order} LIMIT ?"
    params.append(safe_limit)
    result = db_query(source, query, params)
    return {
        "table": table,
        "exists": True,
        "columns": columns,
        "selectedColumns": selected,
        "rows": result.get("rows", []),
        "queryOk": result.get("ok"),
        "error": result.get("error"),
        "remote": result.get("remote"),
    }


def git_status(args: dict[str, Any]) -> dict[str, Any]:
    repo = local_code_path()
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


def paths_status(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "both").strip()
    if source not in ("local", "remote", "both"):
        raise ValueError("source must be local, remote, or both")

    payload: dict[str, Any] = {"source": source}
    if source in ("local", "both"):
        code = local_code_path()
        try:
            state = local_state_root()
            db = workflow_db_file(state)
            local_payload: dict[str, Any] = {
                "codePath": str(code),
                "stateRoot": str(state),
                "database": str(db),
                "codeEqualsState": code.resolve() == state.resolve() if code.exists() and state.exists() else str(code) == str(state),
                "codePathExists": code.exists(),
                "stateRootExists": state.exists(),
                "gitDirExists": (code / ".git").exists(),
                "messageFlowCliExists": (code / "bin" / "cat-meeting-governance.mjs").is_file(),
                "databaseExists": db.is_file(),
            }
            if local_payload["gitDirExists"]:
                local_payload["head"] = run(["git", "rev-parse", "HEAD"], cwd=code).get("stdout")
                local_payload["status"] = run(["git", "status", "--short", "--branch"], cwd=code).get("stdout")
        except ValueError as exc:
            local_payload = {
                "codePath": str(code),
                "codePathExists": code.exists(),
                "gitDirExists": (code / ".git").exists(),
                "stateRootConfigured": False,
                "error": str(exc),
            }
        payload["local"] = local_payload

    if source in ("remote", "both"):
        code_path = remote_code_path()
        state_root = remote_state_root()
        remote_input = json.dumps({"codePath": code_path, "stateRoot": state_root}, ensure_ascii=False)
        remote_code = "\n".join(
            [
                "import json, os, subprocess, sys",
                "p = json.loads(sys.stdin.read())",
                "code = p['codePath']",
                "state = p['stateRoot']",
                f"primary_db = os.path.join(state, '{WORKFLOW_CONTROL_PLANE_DB}')",
                f"legacy_db = os.path.join(state, '{LEGACY_TRACKING_DB}')",
                "db = primary_db if os.path.isfile(primary_db) else legacy_db",
                "def git(args):",
                "    try:",
                "        r = subprocess.run(['git'] + args, cwd=code, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10, check=False)",
                "        return {'ok': r.returncode == 0, 'returncode': r.returncode, 'stdout': (r.stdout or '').strip(), 'stderr': (r.stderr or '').strip()}",
                "    except Exception as exc:",
                "        return {'ok': False, 'error': type(exc).__name__ + ': ' + str(exc)}",
                "out = {",
                "    'codePath': code,",
                "    'stateRoot': state,",
                "    'database': db,",
                "    'codeEqualsState': os.path.abspath(code) == os.path.abspath(state),",
                "    'codePathExists': os.path.isdir(code),",
                "    'stateRootExists': os.path.isdir(state),",
                "    'gitDirExists': os.path.isdir(os.path.join(code, '.git')),",
                "    'messageFlowCliExists': os.path.isfile(os.path.join(code, 'bin', 'cat-meeting-governance.mjs')),",
                "    'databaseExists': os.path.isfile(db),",
                "}",
                "out['head'] = git(['rev-parse', 'HEAD'])",
                "out['status'] = git(['status', '--short', '--branch'])",
                "print(json.dumps(out, ensure_ascii=False))",
            ]
        )
        result = run_remote(f"printf %s {shlex.quote(remote_input)} | python3 -c {shlex.quote(remote_code)}", timeout=30)
        try:
            remote_payload = json.loads(result.get("stdout") or "{}") if result.get("ok") else {}
        except json.JSONDecodeError:
            remote_payload = {}
        remote_payload["remote"] = result
        payload["remote"] = remote_payload

    audit({"event": "paths_status", "source": source})
    return payload


def server_snapshot(args: dict[str, Any]) -> dict[str, Any]:
    path = remote_state_root()
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
        full = f"{remote_state_root().rstrip('/')}/{relative_path}"
        result = run_remote(f"test -f {shlex.quote(full)} && tail -n {limit} {shlex.quote(full)}", timeout=30)
        lines = result.get("stdout", "").splitlines() if result.get("ok") else []
        payload = {"source": source, "path": relative_path, "limit": limit, "lines": lines, "remote": result}
    elif source == "local":
        full_path = local_state_root() / relative_path
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
        db = Path(workflow_db_path(source))
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
        db_path = workflow_db_path(source)
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


def receipts(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    limit = max(1, min(int(args.get("limit") or 50), 200))
    filters = {
        "workflow_id": str(args.get("workflow_id") or args.get("workflowId") or "").strip(),
        "dispatch_id": str(args.get("dispatch_id") or args.get("dispatchId") or "").strip(),
        "agent_id": str(args.get("agent_id") or args.get("agentId") or "").strip(),
        "runtime": str(args.get("runtime") or "").strip(),
        "status": str(args.get("status") or "").strip(),
    }
    runtime_rows = select_table(
        source,
        "runtime_runs",
        [
            "runtime_run_id",
            "dispatch_id",
            "meeting_id",
            "workflow_id",
            "trace_id",
            "runtime",
            "agent_id",
            "adapter",
            "status",
            "failure_type",
            "attempt",
            "started_at",
            "completed_at",
            "latency_ms",
            "message_id",
            "error",
        ],
        filters=filters,
        order_columns=["completed_at", "started_at"],
        limit=limit,
    )
    outbox_contains = {
        "payload_json": filters["workflow_id"] or filters["dispatch_id"],
        "text": str(args.get("text_contains") or args.get("textContains") or "").strip(),
    }
    outbox_rows = select_table(
        source,
        "telegram_outbox",
        ["outbox_id", "meeting_id", "target_kind", "target_ref", "message_type", "status", "created_at", "updated_at", "payload_json"],
        filters={"status": filters["status"]},
        contains=outbox_contains,
        order_columns=["updated_at", "created_at"],
        limit=limit,
    )
    trading_core_rows = select_table(
        source,
        "trading_core_receipts",
        ["receipt_id", "intent_id", "status", "trading_core_ref", "source_system", "created_at", "payload_json"],
        filters={"status": filters["status"]},
        contains={"payload_json": filters["workflow_id"] or filters["dispatch_id"]},
        order_columns=["created_at"],
        limit=limit,
    )
    payload = {
        "source": source,
        "database": workflow_db_path(source),
        "limit": limit,
        "runtimeRuns": runtime_rows,
        "telegramOutbox": outbox_rows,
        "tradingCoreReceipts": trading_core_rows,
    }
    audit({"event": "receipts", "source": source, "runtime_count": len(runtime_rows.get("rows", []))})
    return payload


def message_flows(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    limit = max(1, min(int(args.get("limit") or 50), 200))
    filters = {
        "workflow_id": str(args.get("workflow_id") or args.get("workflowId") or "").strip(),
        "dispatch_id": str(args.get("dispatch_id") or args.get("dispatchId") or "").strip(),
        "status": str(args.get("status") or "").strip(),
        "agent_id": str(args.get("agent_id") or args.get("agentId") or "").strip(),
    }
    rows = select_table(
        source,
        "message_flows",
        [
            "flow_id",
            "message_flow_id",
            "workflow_id",
            "dispatch_id",
            "meeting_id",
            "source_channel",
            "source_account_id",
            "agent_id",
            "runtime",
            "status",
            "final_output_present",
            "delivery_receipt_present",
            "runtime_completed_at",
            "outbox_id",
            "created_at",
            "updated_at",
            "payload_json",
        ],
        filters=filters,
        contains={"payload_json": str(args.get("contains") or "").strip()},
        order_columns=["updated_at", "created_at"],
        limit=limit,
    )
    payload = {"source": source, "database": workflow_db_path(source), "limit": limit, "messageFlows": rows}
    audit({"event": "message_flows", "source": source, "count": len(rows.get("rows", []))})
    return payload


def incidents(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    limit = max(1, min(int(args.get("limit") or 50), 200))
    filters = {
        "status": str(args.get("status") or "").strip(),
        "mode": str(args.get("mode") or "").strip(),
        "incident_id": str(args.get("incident_id") or args.get("incidentId") or "").strip(),
    }
    rows = select_table(
        source,
        "incident_states",
        [
            "incident_id",
            "status",
            "mode",
            "summary",
            "commander",
            "impact",
            "mitigation",
            "declared_at",
            "next_update_at",
            "resolved_at",
            "updated_at",
            "payload_json",
        ],
        filters=filters,
        contains={"payload_json": str(args.get("workflow_id") or args.get("workflowId") or args.get("contains") or "").strip()},
        order_columns=["updated_at", "declared_at"],
        limit=limit,
    )
    payload = {"source": source, "database": workflow_db_path(source), "limit": limit, "incidents": rows}
    audit({"event": "incidents", "source": source, "count": len(rows.get("rows", []))})
    return payload


def reconcile_dry_run(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    limit = max(1, min(int(args.get("limit") or 20), 100))
    stale_after_ms = max(60_000, min(int(args.get("stale_after_ms") or args.get("staleAfterMs") or 300_000), 24 * 3600_000))
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(milliseconds=stale_after_ms)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    stale_dispatches = db_query(
        source,
        """
        SELECT d.dispatch_id, d.workflow_id, d.meeting_id, d.runtime, d.agent_id, d.status,
               d.sent_at, d.updated_at, d.attempt, d.max_attempts,
               (SELECT rr.status FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id ORDER BY COALESCE(rr.completed_at, rr.started_at) DESC LIMIT 1) AS latest_runtime_status,
               (SELECT rr.completed_at FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id ORDER BY COALESCE(rr.completed_at, rr.started_at) DESC LIMIT 1) AS latest_runtime_completed_at
        FROM mixed_meeting_dispatches d
        WHERE d.status='sent' AND COALESCE(NULLIF(d.updated_at,''), d.created_at) < ?
        ORDER BY COALESCE(NULLIF(d.updated_at,''), d.created_at)
        LIMIT ?
        """,
        [cutoff, limit],
    )
    message_flow_columns = table_columns(source, "message_flows")
    message_flow_candidates: dict[str, Any]
    if message_flow_columns:
        where = []
        params: list[Any] = []
        if "runtime_completed_at" in message_flow_columns:
            where.append("runtime_completed_at < ?")
            params.append(cutoff)
        if "final_output_present" in message_flow_columns:
            where.append("final_output_present=1")
        if "delivery_receipt_present" in message_flow_columns:
            where.append("delivery_receipt_present=0")
        if "return_policy" in message_flow_columns:
            placeholders = ", ".join("?" for _ in MESSAGE_FLOW_DELIVERY_RETURN_POLICIES)
            where.append(f"return_policy IN ({placeholders})")
            params.extend(MESSAGE_FLOW_DELIVERY_RETURN_POLICIES)
        query = "SELECT * FROM message_flows"
        if where:
            query += " WHERE " + " AND ".join(where)
        query += " ORDER BY updated_at DESC LIMIT ?" if "updated_at" in message_flow_columns else " LIMIT ?"
        params.append(limit)
        message_flow_candidates = db_query(source, query, params)
    else:
        message_flow_candidates = {"ok": True, "exists": False, "rows": [], "note": "message_flows table not present"}
    incidents_rows = select_table(
        source,
        "incident_states",
        ["incident_id", "status", "mode", "summary", "updated_at", "next_update_at"],
        filters={},
        contains={},
        order_columns=["updated_at", "declared_at"],
        limit=limit,
    )
    payload = {
        "source": source,
        "database": workflow_db_path(source),
        "dryRun": True,
        "staleAfterMs": stale_after_ms,
        "cutoff": cutoff,
        "wouldCall": [
            "workflow.dispatch.reconcile",
            "workflow.message_flow.reconcile",
            "incident.state"
        ],
        "mutated": False,
        "staleDispatchCandidates": stale_dispatches,
        "messageFlowCandidates": message_flow_candidates,
        "recentIncidents": incidents_rows,
    }
    audit({"event": "reconcile_dry_run", "source": source, "stale_count": len(stale_dispatches.get("rows", []))})
    return payload


def message_flow_send(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    from_agent = str(args.get("from_agent") or args.get("fromAgent") or args.get("from") or "").strip()
    body = str(args.get("body") or args.get("text") or args.get("message") or "").strip()
    targets = as_str_list(args.get("to_agents") or args.get("toAgents") or args.get("targets") or args.get("to"))
    if source == "local":
        workflow_root = local_mutation_state_root(args)
        cwd = local_code_path()
    elif source == "remote":
        workflow_root = remote_mutation_state_root(args)
        cwd = remote_code_path()
    else:
        raise ValueError("source must be local or remote")
    if not from_agent:
        raise ValueError("from_agent is required")
    if not body and not str(args.get("subject") or "").strip():
        raise ValueError("body/text/message or subject is required")
    if not targets:
        raise ValueError("to_agents/targets is required")

    cli_args = [
        "node",
        "bin/cat-meeting-governance.mjs",
        "message-flow-send",
        "--from",
        from_agent,
        "--body",
        body,
    ]
    optional_pairs = [
        ("--from-runtime", args.get("from_runtime") or args.get("fromRuntime")),
        ("--subject", args.get("subject")),
        ("--type", args.get("message_type") or args.get("messageType")),
        ("--workflow", args.get("workflow_id") or args.get("workflowId")),
        ("--meeting", args.get("meeting_id") or args.get("meetingId")),
        ("--trace-id", args.get("trace_id") or args.get("traceId")),
        ("--idempotency-key", args.get("idempotency_key") or args.get("idempotencyKey")),
        ("--requires-ack", str(bool(args.get("requires_ack") or args.get("requiresAck"))).lower() if ("requires_ack" in args or "requiresAck" in args) else None),
        ("--ack-timeout-seconds", args.get("ack_timeout_seconds") or args.get("ackTimeoutSeconds")),
        ("--priority", args.get("priority")),
        ("--return-policy", args.get("return_policy") or args.get("returnPolicy")),
        ("--root", workflow_root),
    ]
    for target in targets:
        cli_args.extend(["--to", target])
    for ref in as_str_list(args.get("source_refs") or args.get("sourceRefs")):
        cli_args.extend(["--source-ref", ref])
    for key, value in optional_pairs:
        if value not in (None, ""):
            cli_args.extend([key, str(value)])

    if source == "local":
        result = run(cli_args, cwd=cwd, timeout=60)
    elif source == "remote":
        quoted = " ".join(shlex.quote(part) for part in cli_args)
        result = run_remote(f"cd {shlex.quote(cwd)} && {quoted}", timeout=90, allow_fallback=False)
    try:
        payload = json.loads(result.get("stdout") or "{}") if result.get("ok") else {}
    except json.JSONDecodeError:
        payload = {}
    response = {
        "source": source,
        "ok": result.get("ok"),
        "codePath": str(cwd),
        "workflowRoot": workflow_root,
        "result": payload,
        "command": cli_args[:3] + ["..."],
        "runner": result,
    }
    audit({"event": "message_flow_send", "source": source, "ok": result.get("ok"), "target_count": len(targets)})
    return response


def workflow_task_draft(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    objective = str(args.get("objective") or args.get("goal") or args.get("prompt") or args.get("body") or "").strip()
    subject = str(args.get("subject") or args.get("summary") or args.get("title") or "").strip()
    participants = as_str_list(args.get("participants") or args.get("participant") or args.get("agents") or args.get("agentIds") or args.get("to_agents") or args.get("toAgents") or args.get("targets"))
    if source == "local":
        workflow_root = local_mutation_state_root(args)
        cwd = local_code_path()
    elif source == "remote":
        workflow_root = remote_mutation_state_root(args)
        cwd = remote_code_path()
    else:
        raise ValueError("source must be local or remote")
    if not objective and not subject:
        raise ValueError("objective/goal/prompt/body or subject/summary/title is required")

    cli_args = [
        "node",
        "bin/cat-meeting-governance.mjs",
        "workflow-task-draft",
        "--objective",
        objective or subject,
        "--root",
        workflow_root,
    ]
    optional_pairs = [
        ("--workflow", args.get("workflow_id") or args.get("workflowId")),
        ("--meeting", args.get("meeting_id") or args.get("meetingId")),
        ("--trace-id", args.get("trace_id") or args.get("traceId")),
        ("--idempotency-key", args.get("idempotency_key") or args.get("idempotencyKey")),
        ("--subject", subject),
        ("--type", args.get("task_type") or args.get("taskType")),
        ("--chair", args.get("chair_agent") or args.get("chairAgent") or args.get("chair")),
        ("--secretary", args.get("secretary_agent") or args.get("secretaryAgent") or args.get("secretary")),
        ("--consumer", args.get("consumer_agent") or args.get("consumerAgent") or args.get("consumer")),
        ("--template", args.get("template")),
        ("--priority", args.get("priority")),
        ("--human-gate", str(bool(args.get("requires_human_gate") if "requires_human_gate" in args else args.get("requiresHumanGate", True))).lower()),
        ("--stock-longterm-tracking", str(bool(args.get("stock_longterm_tracking") or args.get("stockLongTermTracking"))).lower() if ("stock_longterm_tracking" in args or "stockLongTermTracking" in args) else None),
        ("--no-default-governance", str(bool(args.get("no_default_governance") or args.get("noDefaultGovernance"))).lower() if ("no_default_governance" in args or "noDefaultGovernance" in args) else None),
    ]
    for participant in participants:
        cli_args.extend(["--participant", participant])
    for key, value in optional_pairs:
        if value not in (None, ""):
            cli_args.extend([key, str(value)])

    if source == "local":
        result = run(cli_args, cwd=cwd, timeout=60)
    elif source == "remote":
        quoted = " ".join(shlex.quote(part) for part in cli_args)
        result = run_remote(f"cd {shlex.quote(cwd)} && {quoted}", timeout=90)
    try:
        payload = json.loads(result.get("stdout") or "{}") if result.get("ok") else {}
    except json.JSONDecodeError:
        payload = {}
    response = {
        "source": source,
        "ok": result.get("ok"),
        "codePath": str(cwd),
        "workflowRoot": workflow_root,
        "result": payload,
        "command": cli_args[:3] + ["..."],
        "runner": result,
    }
    audit({"event": "workflow_task_draft", "source": source, "ok": result.get("ok"), "participant_count": len(participants)})
    return response


def workflow_task_launch_prepare(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    objective = str(args.get("objective") or args.get("goal") or args.get("prompt") or args.get("body") or "").strip()
    subject = str(args.get("subject") or args.get("summary") or args.get("title") or "").strip()
    participants = as_str_list(args.get("participants") or args.get("participant") or args.get("agents") or args.get("agentIds") or args.get("to_agents") or args.get("toAgents") or args.get("targets"))
    if source == "local":
        workflow_root = local_mutation_state_root(args)
        cwd = local_code_path()
    elif source == "remote":
        workflow_root = remote_mutation_state_root(args)
        cwd = remote_code_path()
    else:
        raise ValueError("source must be local or remote")
    if not objective and not subject:
        raise ValueError("objective/goal/prompt/body or subject/summary/title is required")

    cli_args = [
        "node",
        "bin/cat-meeting-governance.mjs",
        "workflow-task-launch-prepare",
        "--objective",
        objective or subject,
        "--root",
        workflow_root,
    ]
    optional_pairs = [
        ("--draft", args.get("draft_id") or args.get("draftId")),
        ("--workflow", args.get("workflow_id") or args.get("workflowId")),
        ("--meeting", args.get("meeting_id") or args.get("meetingId")),
        ("--trace-id", args.get("trace_id") or args.get("traceId")),
        ("--idempotency-key", args.get("idempotency_key") or args.get("idempotencyKey")),
        ("--subject", subject),
        ("--type", args.get("task_type") or args.get("taskType")),
        ("--chair", args.get("chair_agent") or args.get("chairAgent") or args.get("chair")),
        ("--secretary", args.get("secretary_agent") or args.get("secretaryAgent") or args.get("secretary")),
        ("--drafter", args.get("drafter_agent") or args.get("drafterAgent") or args.get("drafter")),
        ("--consumer", args.get("consumer_agent") or args.get("consumerAgent") or args.get("consumer")),
        ("--intent-summary", args.get("intent_summary") or args.get("intentSummary")),
        ("--flashcat-intent", args.get("flashcat_intent") or args.get("flashcatIntent")),
        ("--clarification-status", args.get("clarification_status") or args.get("clarificationStatus")),
        ("--template", args.get("template")),
        ("--priority", args.get("priority")),
        ("--human-gate", str(bool(args.get("requires_human_gate") if "requires_human_gate" in args else args.get("requiresHumanGate", True))).lower()),
        ("--stock-longterm-tracking", str(bool(args.get("stock_longterm_tracking") or args.get("stockLongTermTracking"))).lower() if ("stock_longterm_tracking" in args or "stockLongTermTracking" in args) else None),
        ("--no-default-governance", str(bool(args.get("no_default_governance") or args.get("noDefaultGovernance"))).lower() if ("no_default_governance" in args or "noDefaultGovernance" in args) else None),
    ]
    for participant in participants:
        cli_args.extend(["--participant", participant])
    for question in as_str_list(args.get("open_questions") or args.get("openQuestions")):
        cli_args.extend(["--open-question", question])
    for key, value in optional_pairs:
        if value not in (None, ""):
            cli_args.extend([key, str(value)])

    if source == "local":
        result = run(cli_args, cwd=cwd, timeout=60)
    else:
        quoted = " ".join(shlex.quote(part) for part in cli_args)
        result = run_remote(f"cd {shlex.quote(cwd)} && {quoted}", timeout=90, allow_fallback=False)
    try:
        payload = json.loads(result.get("stdout") or "{}") if result.get("ok") else {}
    except json.JSONDecodeError:
        payload = {}
    response = {
        "source": source,
        "ok": result.get("ok"),
        "codePath": str(cwd),
        "workflowRoot": workflow_root,
        "result": payload,
        "command": cli_args[:3] + ["..."],
        "runner": result,
    }
    audit({"event": "workflow_task_launch_prepare", "source": source, "ok": result.get("ok"), "participant_count": len(participants)})
    return response


def workflow_task_launch_list(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    if source == "local":
        workflow_root = local_mutation_state_root(args)
        cwd = local_code_path()
    elif source == "remote":
        workflow_root = remote_mutation_state_root(args)
        cwd = remote_code_path()
    else:
        raise ValueError("source must be local or remote")
    cli_args = ["node", "bin/cat-meeting-governance.mjs", "workflow-task-launch-list", "--root", workflow_root]
    for key, value in [
        ("--workflow", args.get("workflow_id") or args.get("workflowId")),
        ("--status", args.get("status")),
        ("--limit", args.get("limit")),
    ]:
        if value not in (None, ""):
            cli_args.extend([key, str(value)])
    if source == "local":
        result = run(cli_args, cwd=cwd, timeout=60)
    else:
        quoted = " ".join(shlex.quote(part) for part in cli_args)
        result = run_remote(f"cd {shlex.quote(cwd)} && {quoted}", timeout=90)
    payload = json.loads(result.get("stdout") or "{}") if result.get("ok") else {}
    response = {"source": source, "ok": result.get("ok"), "codePath": str(cwd), "workflowRoot": workflow_root, "result": payload, "command": cli_args[:3] + ["..."], "runner": result}
    audit({"event": "workflow_task_launch_list", "source": source, "ok": result.get("ok")})
    return response


def workflow_task_launch_approve(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    draft_id = str(args.get("draft_id") or args.get("draftId") or "").strip()
    feedback = str(args.get("feedback_text") or args.get("feedbackText") or args.get("flashcat_original_words") or args.get("flashcatOriginalWords") or "").strip()
    if not draft_id:
        raise ValueError("draft_id/draftId is required")
    if not feedback:
        raise ValueError("feedback_text/flashcat_original_words is required")
    if source == "local":
        workflow_root = local_mutation_state_root(args)
        cwd = local_code_path()
    elif source == "remote":
        workflow_root = remote_mutation_state_root(args)
        cwd = remote_code_path()
    else:
        raise ValueError("source must be local or remote")
    cli_args = [
        "node", "bin/cat-meeting-governance.mjs", "workflow-task-launch-approve",
        "--root", workflow_root,
        "--draft", draft_id,
        "--feedback", feedback,
        "--by", str(args.get("approved_by") or args.get("approvedBy") or "flashcat"),
    ]
    if source == "local":
        result = run(cli_args, cwd=cwd, timeout=60)
    else:
        quoted = " ".join(shlex.quote(part) for part in cli_args)
        result = run_remote(f"cd {shlex.quote(cwd)} && {quoted}", timeout=90, allow_fallback=False)
    payload = json.loads(result.get("stdout") or "{}") if result.get("ok") else {}
    response = {"source": source, "ok": result.get("ok"), "codePath": str(cwd), "workflowRoot": workflow_root, "result": payload, "command": cli_args[:3] + ["..."], "runner": result}
    audit({"event": "workflow_task_launch_approve", "source": source, "ok": result.get("ok"), "draft_id": draft_id})
    return response


def workflow_task_launch_review(args: dict[str, Any]) -> dict[str, Any]:
    source = str(args.get("source") or "local").strip()
    draft_id = str(args.get("draft_id") or args.get("draftId") or "").strip()
    opinion = str(args.get("review_opinion") or args.get("reviewOpinion") or args.get("opinion") or args.get("text") or "").strip()
    if not draft_id:
        raise ValueError("draft_id/draftId is required")
    if not opinion:
        raise ValueError("review_opinion/reviewOpinion is required")
    if source == "local":
        workflow_root = local_mutation_state_root(args)
        cwd = local_code_path()
    elif source == "remote":
        workflow_root = remote_mutation_state_root(args)
        cwd = remote_code_path()
    else:
        raise ValueError("source must be local or remote")
    cli_args = [
        "node", "bin/cat-meeting-governance.mjs", "workflow-task-launch-review",
        "--root", workflow_root,
        "--draft", draft_id,
        "--status", str(args.get("status") or args.get("decision") or "approved"),
        "--reviewer", str(args.get("reviewer_agent") or args.get("reviewerAgent") or "main"),
        "--opinion", opinion,
    ]
    if source == "local":
        result = run(cli_args, cwd=cwd, timeout=60)
    else:
        quoted = " ".join(shlex.quote(part) for part in cli_args)
        result = run_remote(f"cd {shlex.quote(cwd)} && {quoted}", timeout=90, allow_fallback=False)
    payload = json.loads(result.get("stdout") or "{}") if result.get("ok") else {}
    response = {"source": source, "ok": result.get("ok"), "codePath": str(cwd), "workflowRoot": workflow_root, "result": payload, "command": cli_args[:3] + ["..."], "runner": result}
    audit({"event": "workflow_task_launch_review", "source": source, "ok": result.get("ok"), "draft_id": draft_id})
    return response


TOOLS: dict[str, dict[str, Any]] = {
    "workflow_git_status": {
        "description": "Return local Git status for the trading-agents-workflow repository.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    "workflow_paths_status": {
        "description": "Report local and remote workflow code paths, state roots, database paths, and key file checks.",
        "inputSchema": {
            "type": "object",
            "properties": {"source": {"type": "string", "enum": ["local", "remote", "both"]}},
            "additionalProperties": False,
        },
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
        "description": "Query the runtime_agents registry from the local or remote workflow control-plane database.",
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
    "workflow_receipts": {
        "description": "Read workflow receipt surfaces: runtime_runs, telegram_outbox, and trading_core_receipts.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "workflow_id": {"type": "string"},
                "workflowId": {"type": "string"},
                "dispatch_id": {"type": "string"},
                "dispatchId": {"type": "string"},
                "agent_id": {"type": "string"},
                "agentId": {"type": "string"},
                "runtime": {"type": "string"},
                "status": {"type": "string"},
                "text_contains": {"type": "string"},
                "textContains": {"type": "string"},
                "limit": {"type": "number"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_message_flows": {
        "description": "Read message_flow records when the workflow database has the message_flows table.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "workflow_id": {"type": "string"},
                "workflowId": {"type": "string"},
                "dispatch_id": {"type": "string"},
                "dispatchId": {"type": "string"},
                "agent_id": {"type": "string"},
                "agentId": {"type": "string"},
                "status": {"type": "string"},
                "contains": {"type": "string"},
                "limit": {"type": "number"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_message_flow_send": {
        "description": "Create governed message_flow dispatches for agent-to-agent notices through trading-agents-workflow. Mutates workflow state.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "from_agent": {"type": "string"},
                "fromAgent": {"type": "string"},
                "from_runtime": {"type": "string"},
                "fromRuntime": {"type": "string"},
                "to_agents": {"type": "array", "items": {"type": "string"}},
                "toAgents": {"type": "array", "items": {"type": "string"}},
                "targets": {"type": "array", "items": {"type": "string"}},
                "subject": {"type": "string"},
                "body": {"type": "string"},
                "message_type": {"type": "string"},
                "messageType": {"type": "string"},
                "workflow_id": {"type": "string"},
                "workflowId": {"type": "string"},
                "meeting_id": {"type": "string"},
                "meetingId": {"type": "string"},
                "trace_id": {"type": "string"},
                "traceId": {"type": "string"},
                "idempotency_key": {"type": "string"},
                "idempotencyKey": {"type": "string"},
                "source_refs": {"type": "array", "items": {"type": "string"}},
                "sourceRefs": {"type": "array", "items": {"type": "string"}},
                "requires_ack": {"type": "boolean"},
                "requiresAck": {"type": "boolean"},
                "priority": {"type": "string"},
                "return_policy": {"type": "string"},
                "returnPolicy": {"type": "string"},
                "workflow_root": {"type": "string"},
                "workflowRoot": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_task_draft": {
        "description": "Draft a governed workflow task plan with Cat Brain/Cat Claw defaults, phases, and quality gates. Pure preview; does not dispatch or mutate workflow state.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "workflow_id": {"type": "string"},
                "workflowId": {"type": "string"},
                "meeting_id": {"type": "string"},
                "meetingId": {"type": "string"},
                "trace_id": {"type": "string"},
                "traceId": {"type": "string"},
                "idempotency_key": {"type": "string"},
                "idempotencyKey": {"type": "string"},
                "subject": {"type": "string"},
                "summary": {"type": "string"},
                "title": {"type": "string"},
                "objective": {"type": "string"},
                "goal": {"type": "string"},
                "prompt": {"type": "string"},
                "body": {"type": "string"},
                "participants": {"type": "array", "items": {"type": "string"}},
                "participant": {"type": "array", "items": {"type": "string"}},
                "agents": {"type": "array", "items": {"type": "string"}},
                "agentIds": {"type": "array", "items": {"type": "string"}},
                "to_agents": {"type": "array", "items": {"type": "string"}},
                "toAgents": {"type": "array", "items": {"type": "string"}},
                "targets": {"type": "array", "items": {"type": "string"}},
                "chair_agent": {"type": "string"},
                "chairAgent": {"type": "string"},
                "chair": {"type": "string"},
                "secretary_agent": {"type": "string"},
                "secretaryAgent": {"type": "string"},
                "secretary": {"type": "string"},
                "consumer_agent": {"type": "string"},
                "consumerAgent": {"type": "string"},
                "consumer": {"type": "string"},
                "task_type": {"type": "string"},
                "taskType": {"type": "string"},
                "template": {"type": "string"},
                "priority": {"type": "string"},
                "requires_human_gate": {"type": "boolean"},
                "requiresHumanGate": {"type": "boolean"},
                "stock_longterm_tracking": {"type": "boolean"},
                "stockLongTermTracking": {"type": "boolean"},
                "no_default_governance": {"type": "boolean"},
                "noDefaultGovernance": {"type": "boolean"},
                "workflow_root": {"type": "string"},
                "workflowRoot": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_task_launch_prepare": {
        "description": "Persist a Cat-Claw-drafted Task Launch Package as canonical JSON/Markdown for Cat Brain review. Mutates workflow state but does not launch tasks.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "draft_id": {"type": "string"},
                "draftId": {"type": "string"},
                "workflow_id": {"type": "string"},
                "workflowId": {"type": "string"},
                "meeting_id": {"type": "string"},
                "meetingId": {"type": "string"},
                "trace_id": {"type": "string"},
                "traceId": {"type": "string"},
                "idempotency_key": {"type": "string"},
                "idempotencyKey": {"type": "string"},
                "subject": {"type": "string"},
                "summary": {"type": "string"},
                "title": {"type": "string"},
                "objective": {"type": "string"},
                "goal": {"type": "string"},
                "prompt": {"type": "string"},
                "body": {"type": "string"},
                "participants": {"type": "array", "items": {"type": "string"}},
                "participant": {"type": "array", "items": {"type": "string"}},
                "agents": {"type": "array", "items": {"type": "string"}},
                "agentIds": {"type": "array", "items": {"type": "string"}},
                "to_agents": {"type": "array", "items": {"type": "string"}},
                "toAgents": {"type": "array", "items": {"type": "string"}},
                "targets": {"type": "array", "items": {"type": "string"}},
                "chair_agent": {"type": "string"},
                "chairAgent": {"type": "string"},
                "secretary_agent": {"type": "string"},
                "secretaryAgent": {"type": "string"},
                "drafter_agent": {"type": "string"},
                "drafterAgent": {"type": "string"},
                "consumer_agent": {"type": "string"},
                "consumerAgent": {"type": "string"},
                "task_type": {"type": "string"},
                "taskType": {"type": "string"},
                "template": {"type": "string"},
                "priority": {"type": "string"},
                "requires_human_gate": {"type": "boolean"},
                "requiresHumanGate": {"type": "boolean"},
                "stock_longterm_tracking": {"type": "boolean"},
                "stockLongTermTracking": {"type": "boolean"},
                "intent_summary": {"type": "string"},
                "intentSummary": {"type": "string"},
                "flashcat_intent": {"type": "string"},
                "flashcatIntent": {"type": "string"},
                "clarification_status": {"type": "string"},
                "clarificationStatus": {"type": "string"},
                "open_questions": {"type": "array", "items": {"type": "string"}},
                "openQuestions": {"type": "array", "items": {"type": "string"}},
                "workflow_root": {"type": "string"},
                "workflowRoot": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_task_launch_list": {
        "description": "List persisted Task Launch Packages.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "workflow_id": {"type": "string"},
                "workflowId": {"type": "string"},
                "status": {"type": "string"},
                "limit": {"type": "number"},
                "workflow_root": {"type": "string"},
                "workflowRoot": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_task_launch_approve": {
        "description": "Approve a Task Launch Package with Flashcat original words and materialize its workflow_tasks. Does not auto-dispatch.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "draft_id": {"type": "string"},
                "draftId": {"type": "string"},
                "feedback_text": {"type": "string"},
                "feedbackText": {"type": "string"},
                "flashcat_original_words": {"type": "string"},
                "flashcatOriginalWords": {"type": "string"},
                "approved_by": {"type": "string"},
                "approvedBy": {"type": "string"},
                "workflow_root": {"type": "string"},
                "workflowRoot": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_task_launch_review": {
        "description": "Record Cat Brain review of a Task Launch Package before Flashcat launch approval.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "draft_id": {"type": "string"},
                "draftId": {"type": "string"},
                "status": {"type": "string"},
                "decision": {"type": "string"},
                "review_opinion": {"type": "string"},
                "reviewOpinion": {"type": "string"},
                "opinion": {"type": "string"},
                "text": {"type": "string"},
                "reviewer_agent": {"type": "string"},
                "reviewerAgent": {"type": "string"},
                "workflow_root": {"type": "string"},
                "workflowRoot": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_incidents": {
        "description": "Read workflow incident_states records.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "incident_id": {"type": "string"},
                "incidentId": {"type": "string"},
                "workflow_id": {"type": "string"},
                "workflowId": {"type": "string"},
                "status": {"type": "string"},
                "mode": {"type": "string"},
                "contains": {"type": "string"},
                "limit": {"type": "number"},
            },
            "additionalProperties": False,
        },
    },
    "workflow_reconcile_dry_run": {
        "description": "Read-only reconcile planner for stale dispatches, message_flow candidates, and incident evidence. Does not mutate workflow state.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "enum": ["local", "remote"]},
                "stale_after_ms": {"type": "number"},
                "staleAfterMs": {"type": "number"},
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
            elif name == "workflow_paths_status":
                payload = paths_status(arguments)
            elif name == "workflow_server_snapshot":
                payload = server_snapshot(arguments)
            elif name == "workflow_latest_jsonl":
                payload = latest_jsonl(arguments)
            elif name == "workflow_runtime_agents":
                payload = runtime_agents(arguments)
            elif name == "workflow_receipts":
                payload = receipts(arguments)
            elif name == "workflow_message_flows":
                payload = message_flows(arguments)
            elif name == "workflow_message_flow_send":
                payload = message_flow_send(arguments)
            elif name == "workflow_task_draft":
                payload = workflow_task_draft(arguments)
            elif name == "workflow_task_launch_prepare":
                payload = workflow_task_launch_prepare(arguments)
            elif name == "workflow_task_launch_list":
                payload = workflow_task_launch_list(arguments)
            elif name == "workflow_task_launch_review":
                payload = workflow_task_launch_review(arguments)
            elif name == "workflow_task_launch_approve":
                payload = workflow_task_launch_approve(arguments)
            elif name == "workflow_incidents":
                payload = incidents(arguments)
            elif name == "workflow_reconcile_dry_run":
                payload = reconcile_dry_run(arguments)
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
