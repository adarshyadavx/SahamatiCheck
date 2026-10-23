"""Write backend/openapi.json from the FastAPI app.

    cd backend && .venv/bin/python scripts/export_openapi.py          # write
    cd backend && .venv/bin/python scripts/export_openapi.py --check  # CI: fail if stale
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("SAHAMATI_DATA_DIR", tempfile.mkdtemp(prefix="sahamati-openapi-"))

from sahamati_api.main import app  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "openapi.json"


def main() -> int:
    spec = json.dumps(app.openapi(), indent=2, ensure_ascii=False, sort_keys=False) + "\n"
    if "--check" in sys.argv:
        if not OUT.is_file() or OUT.read_text(encoding="utf-8") != spec:
            print("backend/openapi.json is stale; run scripts/export_openapi.py")
            return 1
        print("backend/openapi.json is up to date")
        return 0
    OUT.write_text(spec, encoding="utf-8")
    print(f"wrote {OUT} ({len(spec)} bytes, {len(app.openapi()['paths'])} paths)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
