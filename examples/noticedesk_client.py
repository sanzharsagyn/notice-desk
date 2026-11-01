"""Minimal Python client for the Notice Desk API. Standard library only.

    python examples/noticedesk_client.py https://noticedesk.sanzarsagyn.workers.dev N-2026-31411
    python examples/noticedesk_client.py https://noticedesk.sanzarsagyn.workers.dev N-2026-31430 llama-3.1-8b-fast>haiku
    python examples/noticedesk_client.py https://noticedesk.sanzarsagyn.workers.dev --attacks llama-3.2-1b
    python examples/noticedesk_client.py https://noticedesk.sanzarsagyn.workers.dev --batch

A policy is one model key, or a cheap and a strong model joined by ">". Every triage response says
which models ran and why the second one was or was not called, which values were verified in the
notice text, the proposed action, and, when content would be removed, a draft statement of reasons
for the EU DSA Transparency Database.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message = status, code, message


class NoticeDesk:
    def __init__(self, base_url: str, timeout: float = 90):
        self.base = base_url.rstrip("/")
        self.timeout = timeout

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={"content-type": "application/json", "user-agent": "noticedesk-python/2.0"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return json.loads(res.read())
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read())
            except ValueError:
                err = {}
            raise ApiError(e.code, err.get("error", "http_error"), err.get("message", str(e))) from None

    def health(self) -> dict:
        return self._call("GET", "/api/v1/health")

    def models(self) -> list[dict]:
        return self._call("GET", "/api/v1/models")["models"]

    def probe(self) -> dict:
        """Which Workers AI models this deployment can run. Rate-limited to a few a day."""
        return self._call("POST", "/api/v1/probe", {})

    def run(self, item_id: str, model: str) -> dict:
        """One model on one sample notice or attack; the recorded answer is in ["step"]."""
        return self._call("POST", "/api/v1/run", {"itemId": item_id, "model": model})

    def triage_sample(self, notice_id: str, policy: str = "haiku>sonnet") -> dict:
        return self._call("POST", "/api/v1/triage", {"noticeId": notice_id, "policy": policy})

    def triage(self, text: str, sender: str = "", subject: str = "", sender_recent_count: int = 1, policy: str = "haiku>sonnet") -> dict:
        return self._call("POST", "/api/v1/triage", {"policy": policy, "notice": {"from": sender, "subject": subject, "text": text, "senderRecentCount": sender_recent_count}})

    def start_batch(self, model: str = "haiku") -> dict:
        return self._call("POST", "/api/v1/batch", {"model": model})

    def batch(self, batch_id: str) -> dict:
        return self._call("GET", f"/api/v1/batch/{batch_id}")

    def run_batch(self, model: str = "haiku", poll_seconds: float = 20, timeout_seconds: float = 1800) -> dict:
        """Queues every sample notice at half price and waits until the batch has ended."""
        b = self.start_batch(model)
        deadline = time.time() + timeout_seconds
        while True:
            r = self.batch(b["id"])
            if r.get("status") == "ended":
                return r
            if time.time() > deadline:
                raise TimeoutError(f"batch {b['id']} still {r.get('status')}")
            time.sleep(poll_seconds)

    def feedback(self, ai: str, decision: str) -> dict:
        return self._call("POST", "/api/v1/feedback", {"ai": ai, "decision": decision})

    def metrics(self, days: int = 14) -> dict:
        return self._call("GET", f"/api/v1/metrics?days={days}")


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        return 2
    desk = NoticeDesk(argv[1])
    try:
        if argv[2] == "--batch":
            r = desk.run_batch()
            for x in r["results"]:
                print(f"{x['noticeId']}  {x['category']:<22} {x['decision']['act']:<16} ${x['costUsd']:.5f}")
            print(f"\n{len(r['results'])} notices in {r['wallClockMs'] / 1000:.0f} s at half price")
            return 0
        if argv[2] == "--attacks":
            model = argv[3] if len(argv) > 3 else "haiku"
            for item in ["A-1", "A-2", "A-3", "A-4", "A-5"]:
                st = desk.run(item, model)["step"]
                urls = [f[1] for f in st["facts"] if f[0] == "url"]
                print(f"{item}  {st['category']:<22} urls={len(urls)}  flagged={','.join(st['inj']) or '-'}  json={'broken' if st['jsonError'] else 'ok'}")
            return 0
        r = desk.triage_sample(argv[2], argv[3] if len(argv) > 3 else "haiku>sonnet")
    except (ApiError, TimeoutError) as e:
        print(e, file=sys.stderr)
        return 1
    route = " -> ".join(s["modelKey"] for s in r["route"]["steps"])
    print(f"{r['noticeId']}: {r['category']} -> {r['decision']['act']} ({r['decision']['priority']}, {r['decision']['slaHours']} h) via {route}")
    for reason in r["route"]["reasons"]:
        print("  escalated:", reason)
    for f in r["facts"]:
        print(f"  {f['kind']:<16} {f['value'][:50]:<50} “{f['quote'][:60]}”")
    if r["statement"]:
        print("  statement of reasons:", r["statement"]["category"], r["statement"].get("decision_visibility") or r["statement"].get("decision_account"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
