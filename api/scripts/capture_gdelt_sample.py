"""Capture one real GDELT response to verify the JSON field names the parser expects.

Manual only: it makes ONE live request with a generic query and prints the keys and a
shortened sample. GDELT allows one request per 5 seconds; if it answers 429, wait a minute.
Usage: .venv/Scripts/python scripts/capture_gdelt_sample.py "Apple Inc"
"""

import json
import sys

import httpx

query = f'"{sys.argv[1] if len(sys.argv) > 1 else "Apple Inc"}" sourcelang:english'
r = httpx.get(
    "https://api.gdeltproject.org/api/v2/doc/doc",
    params={"query": query, "mode": "artlist", "format": "json", "maxrecords": "3", "timespan": "3d", "sort": "datedesc"},
    timeout=20,
)
print("status:", r.status_code)
try:
    data = r.json()
except ValueError:
    print("not JSON:", r.text[:200])
    raise SystemExit(1)
arts = data.get("articles", [])
print("top-level keys:", list(data))
print("article keys:", list(arts[0]) if arts else "no articles")
print(json.dumps(arts[:1], indent=2)[:600])
