#!/usr/bin/env python3
"""Stdio MCP server for Hermers profiles to call central trading-agents-workflow.

This server is intentionally a thin, capability-scoped control surface. The
workflow core/CLI owns behavior; MCP exposes only a small profile-safe tool set
unless high-risk administrative tools are explicitly enabled by environment.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any


SERVER_NAME = "trading-agents-workflow-hermes"
SERVER_VERSION = "0.1.4"

SCRIPT_WORKFLOW_PACKAGE = Path(__file__).resolve().parents[1]
SERVER_WORKFLOW_PACKAGE = Path("/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout")
DEFAULT_WORKFLOW_PACKAGE = SCRIPT_WORKFLOW_PACKAGE if (SCRIPT_WORKFLOW_PACKAGE / "src" / "core.js").exists() else SERVER_WORKFLOW_PACKAGE
DEFAULT_ACTIVE_WORKFLOW_ROOT = Path("/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow")
LEGACY_WORKFLOW_ROOT = Path("/home/flashcat/.openclaw/shared/trading-agents-workflow")
ALLOW_LEGACY_ROOT_ENV = "TRADING_AGENTS_WORKFLOW_ALLOW_LEGACY_ROOT"
ALLOW_NONDEFAULT_ROOT_ENV = "TRADING_AGENTS_WORKFLOW_ALLOW_NONDEFAULT_ROOT"
EXPECTED_WORKFLOW_SCHEMA_VERSION = 13
REQUIRED_TRACKING_TABLES = {
    "control_loop_jobs",
    "message_flows",
    "runtime_agents",
    "schema_meta",
    "telegram_outbox",
    "workflow_events",
    "workflow_session_packs",
    "workflow_session_runs",
}
MAX_TIMEOUT_SECONDS = 1800
ALLOW_RAW_ACTION_ENV = "TRADING_AGENTS_WORKFLOW_ALLOW_RAW_ACTION"
ALLOW_SCHEDULE_MUTATION_ENV = "TRADING_AGENTS_WORKFLOW_ALLOW_SCHEDULE_MUTATION"


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def profile_id() -> str:
    explicit = os.environ.get("HERMES_PROFILE") or os.environ.get("TRADING_AGENTS_WORKFLOW_PROFILE")
    if explicit:
        return explicit.strip()
    hermes_home = Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser()
    if hermes_home.parent.name == "profiles":
        return hermes_home.name
    return "unknown"


def capability_mode() -> str:
    configured = os.environ.get("TRADING_AGENTS_WORKFLOW_CAPABILITY")
    if configured:
        mode = configured.strip().lower().replace("-", "_")
        if mode in {"full", "governance", "message_only", "disabled"}:
            return mode
    return "governance" if profile_id() == "catheart" else "message_only"


def workflow_package() -> Path:
    return Path(os.environ.get("TRADING_AGENTS_WORKFLOW_PACKAGE", str(DEFAULT_WORKFLOW_PACKAGE))).expanduser()


def truthy_env(name: str) -> bool:
    value = os.environ.get(name)
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def normalized_root(value: str | Path) -> Path:
    return Path(str(value)).expanduser().resolve(strict=False)


def guard_workflow_root(value: str | Path) -> str:
    root = normalized_root(value)
    if root == normalized_root(LEGACY_WORKFLOW_ROOT) and not truthy_env(ALLOW_LEGACY_ROOT_ENV):
        raise ValueError(
            f"legacy trading-agents-workflow root has retired and is fail-closed: {LEGACY_WORKFLOW_ROOT}; "
            "set TRADING_AGENTS_WORKFLOW_ROOT to the active workflow state root"
        )
    if root != normalized_root(DEFAULT_ACTIVE_WORKFLOW_ROOT) and not truthy_env(ALLOW_NONDEFAULT_ROOT_ENV):
        raise ValueError(
            f"non-default trading-agents-workflow root is not allowed through Hermers MCP: {root}; "
            f"expected {DEFAULT_ACTIVE_WORKFLOW_ROOT}; set {ALLOW_NONDEFAULT_ROOT_ENV}=1 only for controlled smoke, "
            "migration, or recovery sessions"
        )
    return str(root)


def guard_tracking_db(root_dir: str) -> None:
    db_file = normalized_root(root_dir) / "tracking.db"
    if db_file.exists() and db_file.is_file():
        try:
            conn = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
            try:
                table_rows = conn.execute(
                    "select name from sqlite_master where type='table' and name in ({})".format(
                        ",".join("?" for _ in REQUIRED_TRACKING_TABLES)
                    ),
                    tuple(sorted(REQUIRED_TRACKING_TABLES)),
                ).fetchall()
                tables = {str(row[0]) for row in table_rows}
                missing = sorted(REQUIRED_TRACKING_TABLES - tables)
                if missing:
                    raise RuntimeError(f"tracking.db missing required tables: {', '.join(missing)}")
                row = conn.execute("select value from schema_meta where key='workflow_schema_version'").fetchone()
                version = int(row[0]) if row and str(row[0]).strip() else 0
                if version != EXPECTED_WORKFLOW_SCHEMA_VERSION:
                    raise RuntimeError(
                        f"tracking.db schema version {version} does not match expected {EXPECTED_WORKFLOW_SCHEMA_VERSION}"
                    )
            finally:
                conn.close()
            return
        except Exception as exc:
            raise RuntimeError(f"tracking.db at configured workflow root is not ready: {db_file}: {exc}") from exc
    raise FileNotFoundError(
        f"tracking.db not found at configured workflow root: {db_file}; "
        "fix TRADING_AGENTS_WORKFLOW_ROOT or initialize the workflow state root outside the Hermers MCP runtime"
    )


def workflow_root(args: dict[str, Any] | None = None) -> str:
    args = args or {}
    configured = guard_workflow_root(os.environ.get("TRADING_AGENTS_WORKFLOW_ROOT") or DEFAULT_ACTIVE_WORKFLOW_ROOT)
    override = args.get("rootDir") or args.get("root") or args.get("workflowRoot") or args.get("workflow_root") or args.get("workflowRootDir")
    if override:
        override_root = guard_workflow_root(override)
        if normalized_root(override_root) != normalized_root(configured):
            raise ValueError("rootDir override is not allowed through Hermers MCP; set TRADING_AGENTS_WORKFLOW_ROOT in the profile MCP config")
    return configured


def guard_payload_root(input_payload: dict[str, Any], root_dir: str) -> None:
    override = (
        input_payload.get("workflowRootDir")
        or input_payload.get("workflow_root")
        or input_payload.get("workflowRoot")
        or input_payload.get("rootDir")
        or input_payload.get("root")
    )
    if override:
        override_root = guard_workflow_root(override)
        if normalized_root(override_root) != normalized_root(root_dir):
            raise ValueError("workflowRootDir override is not allowed through Hermers MCP; use the configured TRADING_AGENTS_WORKFLOW_ROOT")


def clamp_timeout(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        seconds = int(float(value))
    except Exception as exc:
        raise ValueError("timeoutSeconds must be a number") from exc
    if seconds < 1:
        raise ValueError("timeoutSeconds must be positive")
    if seconds > MAX_TIMEOUT_SECONDS:
        raise ValueError("timeoutSeconds must not exceed 1800")
    return seconds


def run_workflow_action(input_payload: dict[str, Any], root_dir: str | None = None, timeout: int = 180) -> dict[str, Any]:
    package = workflow_package()
    core = package / "src" / "core.js"
    if not core.exists():
        raise RuntimeError(f"workflow core not found: {core}")
    resolved_root = root_dir or workflow_root(input_payload)
    guard_tracking_db(resolved_root)
    guard_payload_root(input_payload, resolved_root)
    payload = {
        "rootDir": resolved_root,
        "input": input_payload,
    }
    code = textwrap.dedent(
        f"""
        import {{ runAction }} from {json.dumps(core.resolve().as_uri())};
        let raw = "";
        for await (const chunk of process.stdin) raw += chunk;
        const payload = JSON.parse(raw || "{{}}");
        const result = await runAction(payload.rootDir, payload.input || {{}});
        console.log(JSON.stringify(result));
        """
    )
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        input=json.dumps(payload, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()[-1600:]
        stdout = (proc.stdout or "").strip()[-800:]
        raise RuntimeError(f"workflow action failed exit={proc.returncode}: {stderr or stdout}")
    try:
        return json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"workflow action returned non-json: {(proc.stdout or '')[:1000]}") from exc


WORKFLOW_ACTION_SCHEMA = {
    "type": "object",
    "description": (
        "Low-level workflow action caller for governance/debug profiles. Prefer the dedicated tools first: "
        "workflow_message_flow_send for messages, workflow_status for status/readiness/topology, "
        "workflow_schedule_list for schedule inspection, and workflow_schedule_upsert for schedule changes. "
        "Use this raw tool only when a needed public workflow action has no dedicated MCP tool. "
        "Example status call: {\"action\":\"status\"}. Example runtime registry call: "
        "{\"action\":\"workflow.runtime_agents\",\"sourceSystem\":\"hermers_mcp\"}. "
        "Do not use this raw tool to bypass Human Gate, runtime ownership, or side-effect controls."
    ),
    "properties": {
        "action": {
            "type": "string",
            "description": (
                "Required public workflow action name accepted by trading-agents-workflow, for example status, "
                "workflow.runtime_agents, workflow.readiness, workflow.topology, or another documented action. "
                "Do not invent action names."
            ),
        },
        "payload": {
            "type": "object",
            "description": (
                "Optional action payload object. If omitted, top-level fields other than root/rootDir/workflowRoot are used. "
                "Prefer explicit payload for complex calls."
            ),
        },
    },
    "required": ["action"],
    "additionalProperties": True,
}


SCHEDULE_UPSERT_SCHEMA = {
    "type": "object",
    "description": (
        "Create or update a central workflow schedule. This is an administrative tool for durable recurring/cron workflow "
        "items, not for one-off agent messages. Use workflow_message_flow_send for normal communication. "
        "Required fields: schedule_id, agent, prompt. Choose exactly one timing mode: kind=cron with cron, or kind=interval "
        "with interval_seconds. Example interval schedule: {\"schedule_id\":\"cat_ears.daily-news-check\","
        "\"name\":\"Cat Ears daily news check\",\"agent\":\"cat_ears\",\"runtime\":\"hermers\",\"prompt\":\"Run the daily news check and write receipt.\","
        "\"kind\":\"interval\",\"interval_seconds\":86400,\"priority\":\"normal\",\"timeout_seconds\":600}. "
        "Use registry agent ids with underscores, for example cat_ears or cat_heart."
    ),
    "properties": {
        "schedule_id": {
            "type": "string",
            "description": "Required stable id for this schedule. Use a namespaced id such as cat_ears.daily-news-check.",
        },
        "name": {
            "type": "string",
            "description": "Human-readable schedule name for review and logs.",
        },
        "agent": {
            "type": "string",
            "description": "Required target registry agent id, for example cat_ears, cat_heart, cat_body, main, or cat_claw.",
        },
        "runtime": {
            "type": "string",
            "description": "Target runtime adapter. Default is hermers. Use openclaw only for OpenClaw-native agents.",
        },
        "prompt": {
            "type": "string",
            "description": (
                "Required dispatch prompt for each scheduled run. Include task boundary, expected artifact/receipt, "
                "and stop conditions."
            ),
        },
        "kind": {
            "type": "string",
            "description": "Timing mode: cron or interval. If omitted, interval is inferred when interval_seconds is present; otherwise cron.",
        },
        "cron": {
            "type": "string",
            "description": "Cron expression when kind=cron, for example '0 * * * *'. Include timezone expectations in prompt/payload.",
        },
        "interval_seconds": {
            "type": "integer",
            "description": "Interval seconds when kind=interval, for example 1800 for 30 minutes or 86400 for daily.",
        },
        "next_run_at": {
            "type": "string",
            "description": "Optional ISO timestamp for the next run time. Omit unless intentionally scheduling the first run.",
        },
        "priority": {
            "type": "string",
            "description": "Workflow queue priority such as normal, high, steer, or flash. Do not use flash unless explicitly authorized.",
        },
        "timeout_seconds": {
            "type": "integer",
            "description": "Dispatch timeout in seconds for a scheduled run. Must be positive and no more than 1800.",
        },
        "payload": {
            "type": "object",
            "description": "Optional structured workflow payload JSON. Do not put secrets or credentials here.",
        },
    },
    "required": ["schedule_id", "agent", "prompt"],
    "additionalProperties": True,
}


SCHEDULE_LIST_SCHEMA = {
    "type": "object",
    "description": (
        "List central workflow schedules. Use this before schedule_upsert when checking whether a schedule already exists. "
        "All fields are optional filters. Examples: {} lists recent schedules; {\"agent\":\"cat_heart\",\"runtime\":\"hermers\","
        "\"limit\":20} filters by agent/runtime; {\"schedule_id\":\"cat_ears.daily-news-check\"} checks one schedule."
    ),
    "properties": {
        "schedule_id": {
            "type": "string",
            "description": "Optional exact schedule id filter.",
        },
        "status": {
            "type": "string",
            "description": "Optional status filter if known: active, paused, or disabled.",
        },
        "runtime": {
            "type": "string",
            "description": "Optional runtime filter, for example hermers or openclaw.",
        },
        "agent": {
            "type": "string",
            "description": "Optional registry agent id filter, for example cat_ears or cat_heart.",
        },
        "limit": {
            "type": "integer",
            "description": "Optional maximum number of rows to return. Use a small value such as 20 for inspection.",
        },
    },
    "additionalProperties": True,
}


MESSAGE_FLOW_SEND_SCHEMA = {
    "type": "object",
    "description": (
        "Send one governed message_flow message. Call this tool directly with the fields below; "
        "do not wrap arguments in action/payload, and do not call raw trading_agents_workflow for normal messages. "
        "Minimal example: {\"to\":\"cat_eyes\",\"subject\":\"Need data check\",\"body\":\"Please check daily_qfq accuracy.\","
        "\"requires_ack\":true,\"ack_timeout_seconds\":300}. "
        "Use registry agent ids such as local_codex, cat_body, cat_nose, cat_eyes, cat_ears, cat_heart, "
        "cat_penclaw, main, cat_claw, cat_voice, cat_tail. The sender is filled from the current Hermers profile."
    ),
    "properties": {
        "to": {
            "type": "string",
            "description": (
                "Required target. Prefer a runtime_agents registry id, for example cat_eyes, cat_body, "
                "cat_heart, cat_penclaw, local_codex, main, or cat_claw. runtime:agent targets are also accepted "
                "when a specific adapter route is needed. Do not use old OpenClaw route-shell ids for migrated Hermers agents."
            ),
        },
        "body": {
            "type": "string",
            "description": (
                "Required message body. Include the concrete request, evidence paths, expected output, deadline, "
                "and whether the receiver should write a workflow receipt/artifact. This is the message text sent through message_flow."
            ),
        },
        "subject": {
            "type": "string",
            "description": "Short human-readable title for the message_flow item, for example 'daily_qfq audit handoff'.",
        },
        "from_agent": {
            "type": "string",
            "description": "Optional override for the sender agent id. Usually omit it; the MCP fills this from the current Hermers profile.",
        },
        "from_runtime": {
            "type": "string",
            "description": "Optional override for sender runtime. Usually omit it; default is hermers.",
        },
        "workflow_id": {
            "type": "string",
            "description": "Optional existing workflow id to attach this message to. Omit for a standalone message_flow.",
        },
        "meeting_id": {
            "type": "string",
            "description": "Optional meeting/message-flow grouping id. Omit unless continuing an existing meeting/thread.",
        },
        "requires_ack": {
            "type": "boolean",
            "description": (
                "Set true when the sender needs a receiver ACK/receipt; set false for FYI notices or smoke tests. "
                "ACK routing uses the workflow core ACK contract."
            ),
        },
        "ack_timeout_seconds": {
            "type": "number",
            "description": (
                "Optional ACK timeout in seconds when requires_ack is true. Values are clamped by the workflow core to 5..300 seconds."
            ),
        },
    },
    "required": ["to", "body"],
    "additionalProperties": True,
}


STATUS_SCHEMA = {
    "type": "object",
    "description": (
        "Read central workflow status. Use this for inspection; runtime_agents may refresh a derived registry snapshot artifact. "
        "Examples: {} or {\"view\":\"status\"} for a general snapshot; {\"view\":\"readiness\"} for readiness; "
        "{\"view\":\"runtime_agents\"} for the agent registry; {\"view\":\"topology\"} for route/topology information."
    ),
    "properties": {
        "view": {
            "type": "string",
            "description": "Optional view: status, readiness, topology, runtime_agents, or runtime-agents. Default is status.",
        },
    },
    "additionalProperties": True,
}


def handle_workflow_action(args: dict[str, Any]) -> dict[str, Any]:
    action = str(args.get("action") or "").strip()
    if not action:
        raise ValueError("action is required")
    payload = args.get("payload") if isinstance(args.get("payload"), dict) else {
        key: value for key, value in args.items() if key not in {"payload", "rootDir", "root", "workflowRoot", "workflow_root", "workflowRootDir"}
    }
    payload["action"] = action
    timeout_seconds = clamp_timeout(payload.get("timeoutSeconds") or payload.get("timeout_seconds"))
    if timeout_seconds is not None:
        payload["timeoutSeconds"] = timeout_seconds
    payload.setdefault("sourceRuntime", "hermers")
    payload.setdefault("sourceAgent", profile_id())
    payload.setdefault("createdBy", f"hermers:{profile_id()}")
    payload.setdefault("sourceSystem", "hermers_mcp")
    payload.setdefault("calledAt", now_iso())
    return run_workflow_action(payload, root_dir=workflow_root(args))


def handle_schedule_upsert(args: dict[str, Any]) -> dict[str, Any]:
    timeout_seconds = clamp_timeout(args.get("timeout_seconds") or args.get("timeoutSeconds"))
    payload = {
        "action": "workflow.schedule.upsert",
        "scheduleId": args.get("schedule_id") or args.get("scheduleId"),
        "name": args.get("name"),
        "agentId": args.get("agent") or args.get("agentId"),
        "runtime": args.get("runtime") or "hermers",
        "prompt": args.get("prompt"),
        "scheduleKind": args.get("kind") or args.get("schedule_kind") or ("interval" if args.get("interval_seconds") else "cron"),
        "cronExpr": args.get("cron") or args.get("cron_expr"),
        "intervalSeconds": args.get("interval_seconds") or args.get("intervalSeconds"),
        "nextRunAt": args.get("next_run_at") or args.get("nextRunAt"),
        "priority": args.get("priority") or "normal",
        "payload": args.get("payload") if isinstance(args.get("payload"), dict) else {},
        "createdBy": f"hermers:{profile_id()}",
        "sourceRuntime": "hermers",
        "sourceAgent": profile_id(),
        "sourceSystem": "hermers_mcp",
    }
    if timeout_seconds is not None:
        payload["timeoutSeconds"] = timeout_seconds
    missing = [key for key in ("scheduleId", "agentId", "prompt") if not payload.get(key)]
    if missing:
        raise ValueError(f"missing required fields: {', '.join(missing)}")
    return run_workflow_action(payload, root_dir=workflow_root(args))


def handle_schedule_list(args: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "action": "workflow.schedule.list",
        "scheduleId": args.get("schedule_id") or args.get("scheduleId"),
        "status": args.get("status"),
        "runtime": args.get("runtime"),
        "agentId": args.get("agent") or args.get("agentId"),
        "limit": args.get("limit") or args.get("runLimit"),
        "sourceSystem": "hermers_mcp",
        "sourceAgent": profile_id(),
    }
    return run_workflow_action({k: v for k, v in payload.items() if v not in (None, "")}, root_dir=workflow_root(args))


def handle_message_flow_send(args: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "action": "message_flow.send",
        "fromAgent": args.get("from_agent") or args.get("fromAgent") or profile_id(),
        "fromRuntime": args.get("from_runtime") or args.get("fromRuntime") or "hermers",
        "to": args.get("to") or args.get("target"),
        "body": args.get("body"),
        "subject": args.get("subject"),
        "workflowId": args.get("workflow_id") or args.get("workflowId"),
        "meetingId": args.get("meeting_id") or args.get("meetingId"),
        "requiresAck": args.get("requires_ack") if "requires_ack" in args else args.get("requiresAck"),
        "ackTimeoutSeconds": args.get("ack_timeout_seconds") or args.get("ackTimeoutSeconds"),
        "sourceSystem": "hermers_mcp",
        "createdBy": f"hermers:{profile_id()}",
    }
    if not payload.get("to") or not payload.get("body"):
        raise ValueError("to and body are required")
    return run_workflow_action({k: v for k, v in payload.items() if v not in (None, "")}, root_dir=workflow_root(args))


def handle_status(args: dict[str, Any]) -> dict[str, Any]:
    view = str(args.get("view") or "status").strip().lower()
    action_by_view = {
        "status": "status",
        "readiness": "workflow.readiness",
        "topology": "workflow.topology",
        "runtime_agents": "workflow.runtime_agents",
        "runtime-agents": "workflow.runtime_agents",
    }
    action = action_by_view.get(view)
    if not action:
        raise ValueError("view must be one of: status, readiness, topology, runtime_agents, runtime-agents")
    return run_workflow_action({"action": action, "sourceSystem": "hermers_mcp", "sourceAgent": profile_id()}, root_dir=workflow_root(args))


BASE_TOOLS: dict[str, dict[str, Any]] = {
    "workflow_message_flow_send": {
        "description": (
            "Send a governed internal message through trading-agents-workflow message_flow. "
            "Use this for Hermers agent-to-agent handoff/status/evidence messages. "
            "Call with direct JSON arguments, not an action wrapper. Required fields are to and body; subject is strongly recommended. "
            "Example: {\"to\":\"cat_eyes\",\"subject\":\"Check daily_qfq\",\"body\":\"Please audit daily_qfq and write findings to workflow receipt.\","
            "\"requires_ack\":true,\"ack_timeout_seconds\":300}. "
            "For messages to the local Codex control panel use to=local_codex. "
            "For migrated Hermers agents use registry ids with underscores: cat_body, cat_nose, cat_eyes, cat_ears, cat_heart, cat_penclaw."
        ),
        "inputSchema": MESSAGE_FLOW_SEND_SCHEMA,
    },
}

GOVERNANCE_TOOLS: dict[str, dict[str, Any]] = {
    **BASE_TOOLS,
    "workflow_schedule_list": {
        "description": (
            "List central workflow schedules for inspection before creating or changing schedules. "
            "Optional filters: schedule_id, status, runtime, agent, limit. "
            "Example: {\"agent\":\"cat_heart\",\"runtime\":\"hermers\",\"limit\":20}. This tool is read-only."
        ),
        "inputSchema": SCHEDULE_LIST_SCHEMA,
    },
    "workflow_status": {
        "description": (
            "Get central trading-agents-workflow status/readiness/topology/runtime registry. "
            "Inspection tool; runtime_agents may refresh a derived registry snapshot artifact. "
            "Example calls: {} for general status, {\"view\":\"readiness\"}, "
            "{\"view\":\"runtime_agents\"}, or {\"view\":\"topology\"}."
        ),
        "inputSchema": STATUS_SCHEMA,
    },
}

ADMIN_TOOLS: dict[str, dict[str, Any]] = {
    "workflow_schedule_upsert": {
        "description": (
            "Register or update a governed central workflow schedule. Use only for recurring/cron workflow items, "
            "not for one-off messages. Required fields: schedule_id, agent, prompt. Include either cron or interval_seconds. "
            "Example: {\"schedule_id\":\"cat_ears.daily-news-check\",\"agent\":\"cat_ears\",\"runtime\":\"hermers\","
            "\"prompt\":\"Run the daily news check and write receipt.\",\"kind\":\"interval\",\"interval_seconds\":86400}. "
            f"This administrative mutation surface is exposed only when {ALLOW_SCHEDULE_MUTATION_ENV}=1."
        ),
        "inputSchema": SCHEDULE_UPSERT_SCHEMA,
    },
}

RAW_ACTION_TOOL: dict[str, dict[str, Any]] = {
    "trading_agents_workflow": {
        "description": (
            "Call the central trading-agents-workflow public action interface. Prefer dedicated tools first. "
            "Use this raw action tool only for documented workflow actions that do not have a dedicated MCP tool. "
            "Example: {\"action\":\"status\"} or {\"action\":\"workflow.runtime_agents\",\"sourceSystem\":\"hermers_mcp\"}. "
            "Do not use it to bypass Human Gate, runtime ownership, receipts, or side-effect controls. "
            f"This raw action surface is disabled by default; set {ALLOW_RAW_ACTION_ENV}=1 only for controlled debugging or governance sessions."
        ),
        "inputSchema": WORKFLOW_ACTION_SCHEMA,
    },
}


def tools_for_capability() -> dict[str, dict[str, Any]]:
    mode = capability_mode()
    if mode == "disabled":
        return {}
    if mode in {"full", "governance"}:
        tools = dict(GOVERNANCE_TOOLS)
        if truthy_env(ALLOW_SCHEDULE_MUTATION_ENV):
            tools.update(ADMIN_TOOLS)
        if truthy_env(ALLOW_RAW_ACTION_ENV):
            tools.update(RAW_ACTION_TOOL)
        return tools
    if truthy_env(ALLOW_RAW_ACTION_ENV):
        # Keep raw action opt-in independent from capability so a temporary
        # debugging profile can be opened without widening every profile.
        return {**BASE_TOOLS, **RAW_ACTION_TOOL}
    return BASE_TOOLS


def tool_result(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
        "structuredContent": payload,
    }


def tool_error_result(message: str) -> dict[str, Any]:
    return {
        "content": [{"type": "text", "text": message}],
        "isError": True,
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
        tools = tools_for_capability()
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": [{"name": name, **schema} for name, schema in tools.items()]}}
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        tools = tools_for_capability()
        if name not in tools:
            return {"jsonrpc": "2.0", "id": req_id, "result": tool_error_result(f"tool not available for capability={capability_mode()}: {name}")}
        try:
            if name == "workflow_message_flow_send":
                payload = handle_message_flow_send(args)
            elif name == "trading_agents_workflow":
                payload = handle_workflow_action(args)
            elif name == "workflow_schedule_upsert":
                payload = handle_schedule_upsert(args)
            elif name == "workflow_schedule_list":
                payload = handle_schedule_list(args)
            elif name == "workflow_status":
                payload = handle_status(args)
            else:
                raise ValueError(f"unknown tool: {name}")
            return {"jsonrpc": "2.0", "id": req_id, "result": tool_result(payload)}
        except Exception as exc:
            return {"jsonrpc": "2.0", "id": req_id, "result": tool_error_result(str(exc))}
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
