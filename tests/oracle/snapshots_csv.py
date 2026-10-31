"""
Independent oracle for the snapshots CSV export.

Re-implements `SnapshotHelper.generate_csv_export` (csv.writer, excel dialect) from a
backup file, newest date first with ties by id ascending, and prints counts for a
few list filters.

Usage:  python3 tests/oracle/snapshots_csv.py backup.json out.csv > filters.json
"""
import csv
import io
import json
import sys

HEADERS = ["Date", "Asset Name", "Institution", "Product", "Category", "Amount", "Currency", "Created At"]


def main(path, out_csv):
    data = json.load(open(path))["data"]
    inst = {i["id"]: i["name"] for i in data["institutions"]}
    cat = {c["id"]: c["name"] for c in data["categories"]}
    assets = {a["id"]: a for a in data["assets"]}

    rows = []
    for s in data["snapshots"]:
        a = assets[s["asset_id"]]
        i, c = inst[a["institution_id"]], cat[a["category_id"]]
        name = a.get("name") or f"{i} - {a['product_name']} ({c})"
        created = (s.get("created_at") or "")[:19].replace("T", " ")
        rows.append((s["date"], s["id"], [s["date"], name, i, a["product_name"], c, f"{s['amount']:.2f}", a["currency"], created], a, i, c, s))

    rows.sort(key=lambda r: (r[1]))
    rows.sort(key=lambda r: r[0], reverse=True)  # stable: ties keep id ascending

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(HEADERS)
    for r in rows:
        w.writerow(r[2])
    open(out_csv, "w", newline="").write(buf.getvalue())

    def ids(pred):
        return sorted(r[1] for r in rows if pred(r))

    sets = [
        {"label": "no filters", "ids": ids(lambda r: True)},
        {"label": "currency=CHF", "ids": ids(lambda r: r[3]["currency"] == "CHF")},
        {"label": "search=boursorama", "ids": ids(lambda r: any("boursorama" in (f or "").lower() for f in (r[3].get("name"), r[4], r[3]["product_name"], r[5])))},
        {"label": "start=2026-06-01,end=2026-08-31", "ids": ids(lambda r: "2026-06-01" <= r[0] <= "2026-08-31")},
        {"label": "min=10000,max=50000", "ids": ids(lambda r: 10000 <= r[6]["amount"] <= 50000)},
    ]
    json.dump(sets, sys.stdout)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
