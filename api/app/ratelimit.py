"""In-memory login throttle. Like the write lock in main.py it covers one server process, which is
how this service is deployed; a multi-process deployment would move this into the database."""

import threading
import time
from collections import defaultdict, deque


class LoginThrottle:
    def __init__(self, max_failures: int, window_seconds: int):
        self.max_failures = max_failures
        self.window = window_seconds
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        q = self._failures[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if not q:
            self._failures.pop(key, None)
        return q

    def retry_after(self, key: str, now: float | None = None) -> int:
        """Seconds to wait before this key may try again; 0 when it may try now."""
        now = time.monotonic() if now is None else now
        with self._lock:
            q = self._prune(key, now)
            if len(q) < self.max_failures:
                return 0
            return max(1, int(self.window - (now - q[0])))

    def record_failure(self, key: str, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            self._failures[key].append(now)

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._failures.clear()
            else:
                self._failures.pop(key, None)
