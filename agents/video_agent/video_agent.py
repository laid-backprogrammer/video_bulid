#!/usr/bin/env python3
"""
Controlled video generation agent.

Reads one JSON request from stdin and emits JSONL events on stdout.
The runtime deliberately exposes video-workflow tools instead of arbitrary
shell or file writes. Scene workers write candidates first; the main runner
validates policy before copying candidates into Remotion scene files.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = ROOT / ".scene-codegen" / "agent-runs"
SCRIPT_PATH = ROOT / "src" / "composer" / "script.json"
MANIFEST_PATH = ROOT / "public" / "scenes-manifest.json"
CONTRACT_PATH = ROOT / "src" / "scenes" / "generated" / "CONTRACT.md"
DEFAULT_LLM_BASE_URL = "https://api.moonshot.cn/v1"
DEFAULT_LLM_MODEL = "kimi-k2.6"

EVENT_TYPES = {
    "plan",
    "tool_start",
    "tool_result",
    "scene_candidate_ready",
    "needs_confirmation",
    "validation_failed",
    "done",
    "error",
    "log",
}


def now_ms() -> int:
    return int(time.time() * 1000)


class EventWriter:
    def __init__(self, run_id: str | None = None, log_file: Path | None = None) -> None:
        self.run_id = run_id
        self.log_file = log_file
        if log_file:
            log_file.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, event_type: str, **payload: Any) -> None:
        if event_type not in EVENT_TYPES:
            event_type = "log"
        event = {
            "type": event_type,
            "runId": self.run_id,
            "timestamp": now_ms(),
            **payload,
        }
        line = json.dumps(event, ensure_ascii=False)
        print(line, flush=True)
        if self.log_file:
            with self.log_file.open("a", encoding="utf-8") as f:
                f.write(line + "\n")


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def rel(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def scene_number(scene_id: str) -> str:
    match = re.match(r"^scene(\d+)$", str(scene_id), re.I)
    if not match:
        raise ValueError(f"Invalid sceneId: {scene_id}")
    return match.group(1)


def extract_code(text: str) -> str:
    body = str(text or "").strip()
    fences = re.findall(r"```(?:tsx|ts|typescript|jsx|javascript)?\s*([\s\S]*?)```", body, flags=re.I)
    if fences:
        body = fences[0].strip()
    return (
        body.replace("from '../types'", "from '../../types'")
        .replace('from "../types"', 'from "../../types"')
        .replace("from '../hooks/", "from '../../hooks/")
        .replace('from "../hooks/', 'from "../../hooks/')
        .replace("from '../components/", "from '../../components/")
        .replace('from "../components/', 'from "../../components/')
        .strip()
    )


class PolicyError(Exception):
    pass


class VideoPolicy:
    """Hard write boundary for the video-generation workspace."""

    forbidden_roots = (
        "editor",
        "src/server",
    )
    forbidden_files = {
        "server.mjs",
        "package.json",
        "package-lock.json",
        "start.mjs",
        "vite.config.ts",
        "tsconfig.json",
    }
    video_roots = (
        "src/scenes",
        "src/components",
        "src/hooks",
        "public/captions",
        "public/assets",
        "public/voiceover",
        "output",
        ".scene-codegen",
    )
    root_file = "src/Root.tsx"
    type_file = "src/types.ts"

    def __init__(self, root: Path, run_dir: Path) -> None:
        self.root = root.resolve()
        self.run_dir = run_dir.resolve()

    def resolve(self, path: str | Path) -> Path:
        p = (self.root / path).resolve() if not Path(path).is_absolute() else Path(path).resolve()
        try:
            p.relative_to(self.root)
        except ValueError as exc:
            raise PolicyError(f"Path escapes workspace: {path}") from exc
        return p

    def _rel(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

    def is_forbidden(self, path: str | Path) -> bool:
        p = self.resolve(path)
        r = self._rel(p)
        if r in self.forbidden_files:
            return True
        return any(r == root or r.startswith(root + "/") for root in self.forbidden_roots)

    def is_video_path(self, path: str | Path) -> bool:
        p = self.resolve(path)
        r = self._rel(p)
        if r in {self.root_file, self.type_file}:
            return True
        return any(r == root or r.startswith(root + "/") for root in self.video_roots)

    def assert_video_write(self, path: str | Path, *, actor: str, scene_id: str | None = None) -> Path:
        p = self.resolve(path)
        r = self._rel(p)
        if self.is_forbidden(p):
            raise PolicyError(f"{actor} cannot write forbidden app code: {r}")
        if not self.is_video_path(p):
            raise PolicyError(f"{actor} can only write video workspace paths: {r}")
        if actor == "scene_worker":
            if not scene_id:
                raise PolicyError("scene_worker writes require sceneId")
            candidate = self.scene_candidate_path(scene_id)
            if p != candidate:
                raise PolicyError(f"scene_worker for {scene_id} can only write candidate {rel(candidate)}")
        if actor == "main_agent" and r == self.root_file:
            return p
        return p

    def scene_candidate_path(self, scene_id: str) -> Path:
        n = scene_number(scene_id)
        return self.run_dir / scene_id / f"Scene{n}.generated.tsx"

    def official_scene_path(self, scene_id: str) -> Path:
        n = scene_number(scene_id)
        return self.root / "src" / "scenes" / "generated" / f"Scene{n}.generated.tsx"


class OpenAICompatClient:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        base = (base_url or DEFAULT_LLM_BASE_URL).rstrip("/")
        if base.endswith("/v1"):
            base = base[:-3]
        self.base_url = base
        self.api_key = api_key
        self.model = model or DEFAULT_LLM_MODEL

    @property
    def available(self) -> bool:
        return bool(self.api_key and self.model)

    def temperature(self, requested: float) -> float:
        return 1 if re.match(r"^kimi-k2\.6($|[-_:.])", self.model or "", re.I) else requested

    def is_kimi_k26(self) -> bool:
        return bool(re.match(r"^kimi-k2\.6($|[-_:.])", self.model or "", re.I))

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.2,
        max_tokens: int = 8000,
        tools: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if not self.available:
            raise RuntimeError("Missing OpenAI-compatible API key/model for video agent")
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature(temperature),
            "max_tokens": max_tokens,
        }
        if self.is_kimi_k26():
            payload.update(
                {
                    "temperature": 1,
                    "max_tokens": 32768,
                    "top_p": 0.95,
                    "stream": True,
                    "thinking": {"type": "enabled"},
                }
            )
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/v1/chat/completions",
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=240) as response:
                if payload.get("stream"):
                    content_parts: list[str] = []
                    thinking_parts: list[str] = []
                    for raw_line in response:
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line.startswith("data:"):
                            continue
                        data_text = line[5:].strip()
                        if not data_text:
                            continue
                        if data_text == "[DONE]":
                            break
                        data = json.loads(data_text)
                        choice = (data.get("choices") or [{}])[0]
                        delta = choice.get("delta") or choice.get("message") or {}
                        content_parts.append(delta.get("content") or "")
                        thinking_parts.append(delta.get("reasoning_content") or delta.get("reasoning") or delta.get("thinking") or "")
                    return {"content": "".join(content_parts), "reasoning_content": "".join(thinking_parts)}
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LLM request failed HTTP {exc.code}: {body[:4000]}") from exc
        except Exception as exc:
            raise RuntimeError(f"LLM request failed: {exc}") from exc
        parsed = json.loads(body)
        choice = (parsed.get("choices") or [{}])[0]
        return choice.get("message") or {}


@dataclass
class CommandResult:
    ok: bool
    code: int | None
    stdout: str
    stderr: str

    @property
    def combined(self) -> str:
        return "\n".join(x for x in [self.stdout.strip(), self.stderr.strip()] if x).strip()


def run_command(args: list[str], *, timeout: int = 600) -> CommandResult:
    proc = subprocess.run(
        args,
        cwd=ROOT,
        shell=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return CommandResult(proc.returncode == 0, proc.returncode, proc.stdout, proc.stderr)


def validate_generated_code_static(scene_id: str, code: str) -> list[str]:
    n = scene_number(scene_id)
    export_name = f"Scene{n}Generated"
    problems: list[str] = []
    if f"export const {export_name}" not in code:
        problems.append(f"missing required export {export_name}")
    if "```" in code:
        problems.append("contains markdown fences")
    if re.search(r"from\s+['\"](?:node:|fs|path|child_process)", code):
        problems.append("imports Node APIs")
    if re.search(r"\b(fetch|XMLHttpRequest|localStorage|sessionStorage|document\.|window\.)", code):
        problems.append("uses browser/network globals")
    if re.search(r"from\s+['\"]\.\./(?:types|hooks/|components/)", code):
        problems.append("generated scene imports must use ../../ for shared local modules")
    if "SegmentCue" not in code:
        problems.append("props should type cues with SegmentCue")
    return problems


class SceneWorker:
    def __init__(
        self,
        *,
        scene_id: str,
        goal: str,
        contract: str,
        policy: VideoPolicy,
        llm: OpenAICompatClient,
        writer: EventWriter,
    ) -> None:
        self.scene_id = scene_id
        self.goal = goal
        self.contract = contract
        self.policy = policy
        self.llm = llm
        self.writer = writer

    def run(self) -> dict[str, Any]:
        start = now_ms()
        self.writer.emit("tool_start", tool="scene_worker", sceneId=self.scene_id)
        candidate = self.policy.scene_candidate_path(self.scene_id)
        self.policy.assert_video_write(candidate, actor="scene_worker", scene_id=self.scene_id)
        context = self.build_context()
        llm_used = False
        llm_error = ""
        if self.llm.available:
            try:
                code = self.generate_code(context)
                llm_used = True
            except Exception as exc:
                llm_error = str(exc)
                self.writer.emit(
                    "tool_result",
                    tool="scene_codegen_llm",
                    sceneId=self.scene_id,
                    ok=False,
                    output=llm_error[:4000],
                )
                code = self.fallback_candidate()
        else:
            code = self.fallback_candidate()
        problems = validate_generated_code_static(self.scene_id, code)
        write_text(candidate, code.rstrip() + "\n")
        summary = {
            "sceneId": self.scene_id,
            "candidateFile": rel(candidate),
            "staticProblems": problems,
            "durationMs": now_ms() - start,
            "llmUsed": llm_used,
            "llmError": llm_error,
        }
        write_json(candidate.parent / "summary.json", summary)
        self.writer.emit(
            "scene_candidate_ready",
            sceneId=self.scene_id,
            candidateFile=rel(candidate),
            staticProblems=problems,
            llmUsed=llm_used,
            llmError=llm_error,
        )
        self.writer.emit("tool_result", tool="scene_worker", sceneId=self.scene_id, ok=not problems)
        return summary

    def build_context(self) -> str:
        self.writer.emit("tool_start", tool="build_scene_context", sceneId=self.scene_id)
        result = run_command(["node", "src/composer/scene-codegen-context.mjs", self.scene_id], timeout=180)
        md_path = ROOT / ".scene-codegen" / f"{self.scene_id}.codegen.md"
        if md_path.exists():
            context = md_path.read_text(encoding="utf-8", errors="replace")
        else:
            script = read_json(SCRIPT_PATH, {})
            scene = next((s for s in script.get("scenes", []) if s.get("id") == self.scene_id), {})
            context = json.dumps(scene, ensure_ascii=False, indent=2)
        self.writer.emit(
            "tool_result",
            tool="build_scene_context",
            sceneId=self.scene_id,
            ok=result.ok,
            output=(result.combined or "context ready")[:4000],
        )
        return context

    def generate_code(self, context: str) -> str:
        contract_text = CONTRACT_PATH.read_text(encoding="utf-8", errors="replace") if CONTRACT_PATH.exists() else ""
        system = (
            "You are a Remotion scene worker. You own exactly one scene file. "
            "Return only the full TSX source for the generated scene. "
            "Do not include Markdown fences or explanations."
        )
        user = "\n\n".join(
            [
                f"Goal:\n{self.goal}",
                f"Global style and pacing contract:\n{self.contract}",
                f"Generated scene contract:\n{contract_text}",
                f"Scene context:\n{context}",
            ]
        )
        message = self.llm.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.35,
            max_tokens=12000,
        )
        return extract_code(message.get("content", ""))

    def fallback_candidate(self) -> str:
        official = self.policy.official_scene_path(self.scene_id)
        if official.exists():
            return official.read_text(encoding="utf-8", errors="replace")
        n = scene_number(self.scene_id)
        return f"""import React from 'react';
import {{AbsoluteFill}} from 'remotion';
import type {{SceneAsset, SegmentCue}} from '../../types';

export const Scene{n}Generated: React.FC<{{
  cues: SegmentCue[];
  durationInFrames: number;
  assets?: SceneAsset[];
}}> = ({{cues}}) => {{
  const text = cues.map((cue) => cue.text).join(' ');
  return (
    <AbsoluteFill style={{{{background: '#070b16', color: 'white', alignItems: 'center', justifyContent: 'center', padding: 120}}}}>
      <div style={{{{fontSize: 72, fontWeight: 800, textAlign: 'center'}}}}>{{text || '{self.scene_id}'}}</div>
    </AbsoluteFill>
  );
}};
"""


class VideoAgent:
    def __init__(self, request: dict[str, Any]) -> None:
        self.request = request
        self.run_id = request.get("runId") or f"{int(time.time())}-{uuid.uuid4().hex[:8]}"
        self.run_dir = RUNS_DIR / self.run_id
        self.writer = EventWriter(self.run_id, self.run_dir / "events.jsonl")
        self.policy = VideoPolicy(ROOT, self.run_dir)
        self.mode = request.get("mode") if request.get("mode") in {"confirm", "auto"} else "confirm"
        self.goal = str(request.get("goal") or "Generate the current video").strip()
        self.scene_ids = self.normalize_scene_ids(request.get("sceneIds"))
        self.options = request.get("options") or {}
        self.llm = self.build_llm()

    def build_llm(self) -> OpenAICompatClient:
        script = read_json(SCRIPT_PATH, {})
        req_llm = self.request.get("llm")
        req_llm = req_llm if isinstance(req_llm, dict) else {}

        if "apiKey" in req_llm:
            api_key = req_llm.get("apiKey") or ""
        else:
            api_key = (
                os.getenv("VIDEO_AGENT_API_KEY")
                or os.getenv("MOONSHOT_API_KEY")
                or os.getenv("OPENAI_API_KEY")
                or script.get("llmApiKey")
                or ""
            )
        if "baseUrl" in req_llm:
            base_url = req_llm.get("baseUrl") or DEFAULT_LLM_BASE_URL
        else:
            base_url = (
                os.getenv("VIDEO_AGENT_BASE_URL")
                or os.getenv("MOONSHOT_BASE_URL")
                or os.getenv("OPENAI_BASE_URL")
                or script.get("llmBaseUrl")
                or DEFAULT_LLM_BASE_URL
            )
        if "model" in req_llm:
            model = req_llm.get("model") or ""
        else:
            model = (
                os.getenv("VIDEO_AGENT_MODEL")
                or os.getenv("MOONSHOT_MODEL")
                or os.getenv("OPENAI_MODEL")
                or script.get("llmModel")
                or DEFAULT_LLM_MODEL
            )
        return OpenAICompatClient(str(base_url), str(api_key), str(model))

    def normalize_scene_ids(self, raw: Any) -> list[str]:
        script = read_json(SCRIPT_PATH, {})
        available = [s.get("id") for s in script.get("scenes", []) if s.get("id") and s.get("enabled") is not False]
        if isinstance(raw, list) and raw:
            scene_ids = [str(x) for x in raw]
        else:
            scene_ids = available
        return [sid for sid in scene_ids if re.match(r"^scene\d+$", sid, re.I)]

    def run(self) -> int:
        try:
            self.run_dir.mkdir(parents=True, exist_ok=True)
            write_json(self.run_dir / "request.json", {**self.request, "llm": self.redacted_llm()})
            if not self.scene_ids:
                raise RuntimeError("No sceneIds available for video agent")
            contract = self.create_global_contract()
            candidate_summaries = self.run_scene_workers(contract)
            if self.mode == "confirm" and not self.options.get("autoApproveWrites"):
                self.writer.emit(
                    "needs_confirmation",
                    reason="scene_candidates_ready",
                    message="Scene candidates are ready. Confirm before overwriting generated scene files.",
                    candidates=candidate_summaries,
                )
                self.writer.emit("done", status="waiting_confirmation", runDir=rel(self.run_dir))
                return 0
            self.commit_candidates(candidate_summaries)
            root_review = self.review_root_orchestration()
            if not root_review["ok"]:
                self.writer.emit("validation_failed", **root_review)
                self.writer.emit("done", status="root_review_failed", runDir=rel(self.run_dir))
                return 2
            validation = self.validate_project()
            if not validation["ok"]:
                self.writer.emit("validation_failed", **validation)
                self.writer.emit("done", status="validation_failed", runDir=rel(self.run_dir))
                return 2
            if self.options.get("renderPreview"):
                self.render_previews()
            if self.options.get("renderFull"):
                if self.mode == "confirm" and not self.options.get("autoApproveRenderFull"):
                    self.writer.emit(
                        "needs_confirmation",
                        reason="render_full_video",
                        message="Confirm before rendering the full video.",
                    )
                else:
                    self.render_full_video()
            self.writer.emit("done", status="completed", runDir=rel(self.run_dir), rootReview=root_review, validation=validation)
            return 0
        except Exception as exc:
            self.writer.emit("error", message=str(exc), traceback=traceback.format_exc()[-8000:])
            return 1

    def redacted_llm(self) -> dict[str, Any]:
        raw = self.request.get("llm") or {}
        return {**raw, "apiKey": "***" if raw.get("apiKey") else ""}

    def create_global_contract(self) -> str:
        self.writer.emit("tool_start", tool="create_global_contract")
        fallback = (
            f"# Global video contract\n\nGoal: {self.goal}\n\n"
            "- Keep visual continuity across scenes.\n"
            "- Use runtime cues and word timing for important motion.\n"
            "- Keep captions readable and avoid blocking key visuals.\n"
            "- Scene workers may be creative but must obey the generated scene contract.\n"
        )
        if self.llm.available:
            script = read_json(SCRIPT_PATH, {})
            prompt = {
                "goal": self.goal,
                "sceneIds": self.scene_ids,
                "scenes": [
                    {
                        "id": s.get("id"),
                        "text": s.get("text", "")[:800],
                        "designNotes": s.get("designNotes", "")[:1200],
                        "tuningNotes": s.get("tuningNotes", "")[:1200],
                        "assetCount": len(s.get("assets") or []),
                    }
                    for s in script.get("scenes", [])
                    if s.get("id") in self.scene_ids
                ],
            }
            try:
                message = self.llm.chat(
                    [
                        {
                            "role": "system",
                            "content": (
                                "Create a concise global Remotion video contract: style, pacing, "
                                "caption placement, transition intent, asset policy, and forbidden patterns. "
                                "Do not write code."
                            ),
                        },
                        {"role": "user", "content": json.dumps(prompt, ensure_ascii=False, indent=2)},
                    ],
                    temperature=0.25,
                    max_tokens=2500,
                )
                contract = str(message.get("content") or "").strip() or fallback
            except Exception as exc:
                contract = fallback + f"\n\nLLM contract failed: {exc}\n"
        else:
            contract = fallback
        write_text(self.run_dir / "global_contract.md", contract.rstrip() + "\n")
        self.writer.emit("plan", goal=self.goal, mode=self.mode, sceneIds=self.scene_ids, contractFile=rel(self.run_dir / "global_contract.md"))
        self.writer.emit("tool_result", tool="create_global_contract", ok=True, output=contract[:2000])
        return contract

    def run_scene_workers(self, contract: str) -> list[dict[str, Any]]:
        max_workers = max(1, min(len(self.scene_ids), int(self.options.get("maxWorkers") or 4)))
        self.writer.emit("tool_start", tool="run_scene_workers", sceneIds=self.scene_ids, maxWorkers=max_workers)
        summaries: list[dict[str, Any]] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [
                pool.submit(
                    SceneWorker(
                        scene_id=scene_id,
                        goal=self.goal,
                        contract=contract,
                        policy=self.policy,
                        llm=self.llm,
                        writer=self.writer,
                    ).run
                )
                for scene_id in self.scene_ids
            ]
            for future in concurrent.futures.as_completed(futures):
                summaries.append(future.result())
        summaries.sort(key=lambda item: item["sceneId"])
        write_json(self.run_dir / "scene_candidates.json", summaries)
        self.writer.emit("tool_result", tool="run_scene_workers", ok=True, candidates=summaries)
        return summaries

    def commit_candidates(self, summaries: list[dict[str, Any]]) -> None:
        self.writer.emit("tool_start", tool="commit_scene_candidates")
        committed: list[dict[str, str]] = []
        for item in summaries:
            scene_id = item["sceneId"]
            candidate = self.policy.scene_candidate_path(scene_id)
            target = self.policy.official_scene_path(scene_id)
            self.policy.assert_video_write(target, actor="main_agent")
            if not candidate.exists():
                raise RuntimeError(f"Missing candidate for {scene_id}: {candidate}")
            backup = self.run_dir / scene_id / f"{target.name}.before"
            if target.exists():
                shutil.copyfile(target, backup)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(candidate, target)
            committed.append({"sceneId": scene_id, "target": rel(target), "backup": rel(backup) if backup.exists() else ""})
        write_json(self.run_dir / "committed.json", committed)
        self.writer.emit("tool_result", tool="commit_scene_candidates", ok=True, committed=committed)

    def review_root_orchestration(self) -> dict[str, Any]:
        self.writer.emit("tool_start", tool="review_root_orchestration")
        root_path = ROOT / "src" / "Root.tsx"
        problems: list[str] = []
        try:
            root_code = root_path.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:
            root_code = ""
            problems.append(f"cannot read Root.tsx: {exc}")

        for token in ("id=\"AgentDiscussion\"", "id=\"PreviewScene\"", "TransitionSeries"):
            if token not in root_code:
                problems.append(f"Root.tsx is missing {token}")
        for scene_id in self.scene_ids:
            n = scene_number(scene_id)
            component = f"Scene{n}Generated"
            if component not in root_code:
                problems.append(f"Root.tsx does not reference {component}")
            if f"{scene_id}: {component}" not in root_code:
                problems.append(f"Root.tsx does not map {scene_id} to {component}")

        review = {
            "ok": not problems,
            "rootFile": rel(root_path),
            "sceneIds": self.scene_ids,
            "problems": problems,
        }
        write_json(self.run_dir / "root_review.json", review)
        self.writer.emit("tool_result", tool="review_root_orchestration", **review)
        return review

    def validate_project(self) -> dict[str, Any]:
        checks = [
            ["npx", "tsc", "--noEmit"],
            ["npm", "run", "editor:build"],
        ]
        outputs: list[str] = []
        for args in checks:
            self.writer.emit("tool_start", tool="run_allowed_check", command=args)
            try:
                result = run_command(args, timeout=600)
            except Exception as exc:
                result = CommandResult(False, None, "", str(exc))
            outputs.append(f"$ {' '.join(args)}\n{result.combined}".strip())
            self.writer.emit(
                "tool_result",
                tool="run_allowed_check",
                command=args,
                ok=result.ok,
                code=result.code,
                output=result.combined[-6000:],
            )
            if not result.ok:
                return {"ok": False, "failedCommand": args, "output": "\n\n".join(outputs)[-12000:]}
        return {"ok": True, "output": "\n\n".join(outputs)[-12000:]}

    def render_previews(self) -> None:
        self.rebuild_manifest()
        manifest = read_json(MANIFEST_PATH, {})
        scenes = {scene.get("id"): scene for scene in manifest.get("scenes", []) if scene.get("id")}
        remotion_cli = ROOT / "node_modules" / "@remotion" / "cli" / "remotion-cli.js"
        for scene_id in self.scene_ids:
            self.writer.emit("tool_start", tool="render_scene_preview", sceneId=scene_id)
            scene = scenes.get(scene_id)
            if not scene:
                raise RuntimeError(f"Scene {scene_id} is not available in manifest")
            props_file = ROOT / "output" / f"{scene_id}.agent.props.json"
            write_json(props_file, {"sceneId": scene_id, "scenes": [scene], "fps": manifest.get("fps", 30)})
            result = run_command(
                [
                    "node",
                    str(remotion_cli),
                    "render",
                    "PreviewScene",
                    f"output/{scene_id}.preview.mp4",
                    "--props",
                    rel(props_file),
                ],
                timeout=1200,
            )
            self.writer.emit("tool_result", tool="render_scene_preview", sceneId=scene_id, ok=result.ok, output=result.combined[-6000:])
            if not result.ok:
                raise RuntimeError(f"Preview render failed for {scene_id}: {result.combined[-2000:]}")

    def render_full_video(self) -> None:
        self.writer.emit("tool_start", tool="render_full_video")
        self.rebuild_manifest()
        result = run_command(["npm", "run", "build"], timeout=1800)
        self.writer.emit("tool_result", tool="render_full_video", ok=result.ok, output=result.combined[-6000:])
        if not result.ok:
            raise RuntimeError(f"Full render failed: {result.combined[-2000:]}")

    def rebuild_manifest(self) -> None:
        self.writer.emit("tool_start", tool="rebuild_manifest")
        result = run_command(
            [
                "node",
                "-e",
                "import('./src/server/manifest-service.mjs').then(m=>m.buildManifest()).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})",
            ],
            timeout=180,
        )
        self.writer.emit("tool_result", tool="rebuild_manifest", ok=result.ok, output=result.combined[-4000:])
        if not result.ok:
            raise RuntimeError(f"Manifest rebuild failed: {result.combined[-2000:]}")


def run_self_test() -> int:
    run_dir = RUNS_DIR / f"self-test-{uuid.uuid4().hex[:8]}"
    policy = VideoPolicy(ROOT, run_dir)
    cases = [
        ("scene worker own candidate", lambda: policy.assert_video_write(policy.scene_candidate_path("scene1"), actor="scene_worker", scene_id="scene1"), True),
        ("scene worker server block", lambda: policy.assert_video_write(ROOT / "server.mjs", actor="scene_worker", scene_id="scene1"), False),
        ("scene worker other scene block", lambda: policy.assert_video_write(policy.scene_candidate_path("scene2"), actor="scene_worker", scene_id="scene1"), False),
        ("main root allowed", lambda: policy.assert_video_write(ROOT / "src" / "Root.tsx", actor="main_agent"), True),
        ("main editor block", lambda: policy.assert_video_write(ROOT / "editor" / "src" / "main.tsx", actor="main_agent"), False),
    ]
    failures = []
    for name, fn, should_pass in cases:
        try:
            fn()
            passed = True
        except PolicyError:
            passed = False
        if passed != should_pass:
            failures.append(name)
    source = ROOT / "agents" / "reference" / "s_full.py"
    if source.exists():
        digest = hashlib.sha256(source.read_bytes()).hexdigest().upper()
        if digest != "D47357E01443353A3E4B7AAEF164B4BF1C3B2D569137A1BDF00A7FF457D2CED2":
            failures.append("reference hash mismatch")
    if failures:
        print(json.dumps({"ok": False, "failures": failures}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True}, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return run_self_test()
    try:
        request = json.loads(sys.stdin.read() or "{}")
    except Exception as exc:
        EventWriter().emit("error", message=f"Invalid JSON request: {exc}")
        return 1
    return VideoAgent(request).run()


if __name__ == "__main__":
    raise SystemExit(main())
