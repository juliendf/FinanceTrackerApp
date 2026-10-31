"""
Golden capture for the dashboards, from the *source* Flask app.

Runs the real FinanceTracker code (read-only: bytecode writing is disabled and
the database is a throwaway SQLite file in a temp dir) against a backup, with
"today" frozen, and writes the JSON the chart endpoints return. The TypeScript
port is then compared against these files; the two share no code.

    SOURCE_REPO=~/Documents/devops/perso/AI/FinanceTracker \
    /tmp/ftoracle/.venv/bin/python tests/oracle/dashboard.py backup.json OUT_DIR 2026-10-26 [2026-03-15 ...]

Needs the source's requirements plus `freezegun`.
"""
import json
import os
import sys
import tempfile

sys.dont_write_bytecode = True
SRC = os.path.expanduser(os.environ["SOURCE_REPO"])
sys.path.insert(0, SRC)

backup, out_dir, *dates = sys.argv[1:]
tmp = tempfile.mkdtemp(prefix="ft-oracle-")
os.environ["DATABASE_URL"] = f"sqlite:///{tmp}/oracle.db"
os.environ["FLASK_SECRET_KEY"] = "oracle"
os.environ.setdefault("FLASK_ENV", "development")

from freezegun import freeze_time  # noqa: E402
from app.app import create_app  # noqa: E402
from app.database import db  # noqa: E402
from app.models.core import User  # noqa: E402
from app.services.data_export import import_all_data  # noqa: E402

app = create_app({
    "SECRET_KEY": "oracle",
    "SQLALCHEMY_DATABASE_URI": f"sqlite:///{tmp}/oracle.db",
    "SESSION_TYPE": "filesystem",
    "SESSION_FILE_DIR": f"{tmp}/sessions",
    "TESTING": True,
    "SQLALCHEMY_ENGINE_OPTIONS": {},
})

os.makedirs(out_dir, exist_ok=True)

with app.app_context():
    db.create_all()
    user = User(username="oracle", email="oracle@example.com", api_key="oracle-key", first_name="O", last_name="R")
    user.set_password("oracle-password-123")
    db.session.add(user)
    db.session.commit()
    uid = user.id
    count, _ = import_all_data(uid, open(backup).read(), replace=True)
    print("imported", count)

client = app.test_client()
H = {"X-API-Key": "oracle-key"}
RANGES = ["1W", "1M", "3M", "6M", "1Y", "YTD", "ALL"]


def get(path):
    r = client.get(path, headers=H)
    assert r.status_code == 200, (path, r.status_code, r.data[:200])
    return r.get_json()


with app.app_context():
    from app.models.core import Asset, Category
    from app.services.dashboard_service import DashboardService
    asset_rows = Asset.query.filter_by(user_id=uid).all()
    asset_ids = [a.id for a in asset_rows]
    # The oracle database numbers assets afresh; identify them by name instead.
    asset_keys = {str(a.id): {"institution": a.institution.name, "product": a.product_name} for a in asset_rows}
    category_ids = [c.id for c in Category.query.filter_by(user_id=uid).all()]


def capture(today):
    out = {"today": today, "asset_keys": asset_keys, "portfolio": {}, "distribution": {}, "resume": {}, "asset": {}, "category": {}}
    with freeze_time(today):
        for r in RANGES:
            out["portfolio"][r] = get(f"/api/charts/portfolio-evolution?range={r}")
        for g in ["institution", "category", "currency", "product"]:
            out["distribution"][g] = get(f"/api/charts/distribution/by-{g}")
        for r in ["ALL", "YTD", "1M", "3M", "6M", "1Y", "BOGUS"]:
            out["resume"][r] = get(f"/api/charts/resume?range={r}")
        for aid in asset_ids:
            out["asset"][str(aid)] = get(f"/api/charts/asset-evolution/{aid}")
        for cid in category_ids:
            out["category"][str(cid)] = get(f"/api/charts/category-evolution/{cid}")
        with app.app_context():
            out["summary"] = DashboardService.get_summary(user_id=uid)
            out["breakdown"] = DashboardService.get_asset_breakdown(user_id=uid)
    return out


for d in dates:
    path = os.path.join(out_dir, f"golden-{d}.json")
    with open(path, "w") as fh:
        json.dump(capture(d), fh, default=str, indent=1)
    print("wrote", path)
