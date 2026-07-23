"""Claude Code CLI connector — shells out to the `claude` binary for read-only
case-resolution drafting. No file edits, no repo access: the CLI is invoked with
a plain text prompt over stdin and returns a resolution write-up as text.

Mirrors the stateless-function shape of app.connectors.ado_client (no client
object, just an async function per capability), so callers don't need to
manage any connector state.
"""
from __future__ import annotations

import asyncio
import json

import structlog

log = structlog.get_logger()

CLAUDE_BIN = "claude"
DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_MODEL = "sonnet"


class ClaudeCliError(RuntimeError):
    pass


async def run_claude_cli(prompt: str, timeout: int = DEFAULT_TIMEOUT_SECONDS) -> str:
    """Run the Claude Code CLI non-interactively and return its text response.

    Uses `--print` (one-shot, non-interactive) with `--output-format json` so the
    response can be parsed reliably, and `--permission-mode plan` so the CLI can
    only analyse and draft text — it cannot edit files or run other tools. Pinned
    to Sonnet (`--model sonnet`) for predictable per-ticket cost/latency rather
    than inheriting whatever model the ambient session defaults to. The prompt is
    passed on stdin, not argv, so arbitrarily long case text never hits OS
    argv-length limits or gets interpreted as extra CLI flags.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            CLAUDE_BIN,
            "--print",
            "--output-format", "json",
            "--permission-mode", "plan",
            "--model", DEFAULT_MODEL,
            # Ignore any MCP servers configured in the mounted ~/.claude.json
            # (e.g. the host's stdio "smartwindowsaccess" server, whose local
            # command doesn't exist in this container). Loading it made plan-mode
            # runs stall past the timeout; an empty strict config keeps this a
            # fast single-turn text call (~40s instead of >120s).
            "--strict-mcp-config",
            "--mcp-config", '{"mcpServers":{}}',
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            # Draft from an empty dir, not /app, so the agent doesn't wander into
            # the backend source while analysing the case.
            cwd="/tmp",
        )
    except FileNotFoundError as exc:
        raise ClaudeCliError(
            "`claude` CLI not found on PATH — install Claude Code to enable resolution."
        ) from exc

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(prompt.encode("utf-8")), timeout=timeout
        )
    except asyncio.TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise ClaudeCliError(f"claude CLI timed out after {timeout}s") from exc

    if proc.returncode != 0:
        log.warning("claude_cli.nonzero_exit", code=proc.returncode, stderr=stderr.decode(errors="replace")[:500])
        raise ClaudeCliError(f"claude CLI exited {proc.returncode}: {stderr.decode(errors='replace')[:500]}")

    try:
        payload = json.loads(stdout.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ClaudeCliError("claude CLI returned non-JSON output") from exc

    result = payload.get("result")
    if not result:
        raise ClaudeCliError("claude CLI JSON response had no 'result' field")
    return result
