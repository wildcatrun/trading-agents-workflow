#!/usr/bin/env python3
"""Smoke-test Hermers MCP capability surfaces.

This is intentionally small and local: it verifies the model-visible tool list
without requiring a live workflow database or a running Hermes profile.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "scripts" / "trading_agents_workflow_hermes_mcp.py"


def list_tools(env: dict[str, str]) -> set[str]:
    requests = "\n".join(
        [
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
            "",
        ]
    )
    proc = subprocess.run(
        ["python3", str(SERVER)],
        cwd=str(ROOT),
        env={**os.environ, **env},
        input=requests,
        text=True,
        capture_output=True,
        check=True,
    )
    responses = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
    tools = responses[-1]["result"]["tools"]
    return {tool["name"] for tool in tools}


def call_tool(env: dict[str, str], name: str, arguments: dict[str, object]) -> dict[str, object]:
    requests = "\n".join(
        [
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": name, "arguments": arguments}}),
            "",
        ]
    )
    proc = subprocess.run(
        ["python3", str(SERVER)],
        cwd=str(ROOT),
        env={**os.environ, **env},
        input=requests,
        text=True,
        capture_output=True,
        check=True,
    )
    responses = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
    return responses[-1]["result"]


def assert_tools(label: str, actual: set[str], expected: set[str]) -> None:
    if actual != expected:
        raise AssertionError(f"{label}: expected {sorted(expected)}, got {sorted(actual)}")


def main() -> int:
    assert_tools(
        "message_only profile",
        list_tools({"HERMES_PROFILE": "catbody"}),
        {"workflow_message_flow_send"},
    )
    assert_tools(
        "governance profile",
        list_tools({"HERMES_PROFILE": "catheart"}),
        {"workflow_message_flow_send", "workflow_status", "workflow_schedule_list"},
    )
    assert_tools(
        "explicit admin opt-in",
        list_tools(
            {
                "HERMES_PROFILE": "catheart",
                "TRADING_AGENTS_WORKFLOW_ALLOW_RAW_ACTION": "1",
                "TRADING_AGENTS_WORKFLOW_ALLOW_SCHEDULE_MUTATION": "1",
            }
        ),
        {
            "workflow_message_flow_send",
            "workflow_status",
            "workflow_schedule_list",
            "workflow_schedule_upsert",
            "trading_agents_workflow",
        },
    )
    denied = call_tool(
        {"HERMES_PROFILE": "catheart"},
        "trading_agents_workflow",
        {"action": "status"},
    )
    if not denied.get("isError") or "tool not available" not in str(denied.get("content")):
        raise AssertionError(f"raw action should be denied without opt-in, got {denied}")
    print("Hermers MCP surface smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
