"""
Independent oracle for the asset list filters.

Re-implements the query in `FinanceTracker/app/routes/assets.py:list_assets` from a
backup file, without sharing any code with the TypeScript port:

    JOIN institution, category
    WHERE  ilike(institution.name | product_name | category.name | code_nin, %search%)
      AND  currency = ?  AND  category.name = ?  AND  institution.name = ?
      AND  EXISTS tag named ?
    ORDER BY institution.name, product_name

Usage:  python3 tests/oracle/asset_filters.py backup.json  > oracle.json
"""
import json
import sys

FILTER_SETS = [
    {"label": "search=boursorama", "search": "boursorama"},
    {"label": "currency=CHF", "currency": "CHF"},
    {"label": "category=Courant + institution=Credit Mutuel", "category": "Courant", "institution": "Credit Mutuel"},
    {"label": "tag=Illiquide", "tag": "Illiquide"},
    {"label": "search=courant + currency=EUR", "search": "courant", "currency": "EUR"},
    {"label": "search=SCPI (matches institution, product and category)", "search": "SCPI"},
    {"label": "no filters"},
]


def main(path):
    data = json.load(open(path))["data"]
    institutions = {i["id"]: i["name"] for i in data["institutions"]}
    categories = {c["id"]: c["name"] for c in data["categories"]}
    out = []
    for fs in FILTER_SETS:
        rows = []
        for a in data["assets"]:
            inst, cat = institutions[a["institution_id"]], categories[a["category_id"]]
            needle = fs.get("search", "").lower()
            if needle and not any(
                needle in (field or "").lower()
                for field in (inst, a["product_name"], cat, a.get("code_nin"))
            ):
                continue
            if fs.get("currency") and a["currency"] != fs["currency"]:
                continue
            if fs.get("category") and cat != fs["category"]:
                continue
            if fs.get("institution") and inst != fs["institution"]:
                continue
            if fs.get("tag") and fs["tag"] not in (a.get("tag_names") or []):
                continue
            rows.append((inst.lower(), a["product_name"].lower(), a["id"]))
        rows.sort()
        out.append({"label": fs["label"], "count": len(rows), "ids": sorted(r[2] for r in rows)})
    print(json.dumps(out, indent=1))


main(sys.argv[1])
