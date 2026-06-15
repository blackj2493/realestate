"""
Overture Maps -> GTA grocery + recreation POI extractor.

Source: Overture Maps `places` theme (release 2026-05-20.0), licensed CDLA-Permissive
2.0 (commercial use OK, attribution only -- no share-alike). Read anonymously from the
public S3 bucket via DuckDB httpfs+spatial, filtered to the GTA bbox and a broad set of
grocery/recreation categories. The raw candidates are written verbatim (category string
preserved); the precise grocery/recreation mapping is finalized downstream in the TS
build script (scripts/admin/build-amenities-dataset.ts).

Deterministic extract -- no AI (CLAUDE.md s4). Output feeds data/gta-amenities.json.

Usage:
  python scripts/admin/overture_amenities.py --discover   # list candidate categories + counts
  python scripts/admin/overture_amenities.py              # write the raw candidate file
"""
import json
import os
import sys
import duckdb

RELEASE = "2026-05-20.0"
PLACES = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"

# GTA bounding box (lng/lat). West of Burlington -> east of Oshawa; lake shore -> Barrie.
XMIN, XMAX = -80.0, -78.5
YMIN, YMAX = 43.0, 44.5

# Broad keyword net on categories.primary; narrowed to grocery/recreation downstream.
KEYWORDS = [
    "grocer", "supermarket", "market",
    "recreation", "community", "leisure", "aquatic",
    "arena", "rink", "fitness", "gym", "sport",
]

OUT_DIR = os.path.join(os.getcwd(), "data", "_geo_src")
OUT_FILE = os.path.join(OUT_DIR, "overture-amenities-raw.json")


def connect():
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET s3_region='us-west-2';")
    return con


# Precise category selection for the extract, derived from --discover output.
# Grocery = any *_grocery_store + supermarket + wholesale_grocer (excludes farmers/
# flea/night markets and ambiguous health_market). Recreation = community_center +
# sports_and_recreation_venue (excludes standalone gyms, sports clubs/leagues, rinks/
# arenas, and the catch-all community_services_non_profits). Final grocery|recreation
# labelling happens in build-amenities-dataset.ts; this just scopes the S3 scan.
REC_CATEGORIES = ("community_center", "sports_and_recreation_venue")


def where_clause() -> str:
    rec_in = ", ".join([f"'{c}'" for c in REC_CATEGORIES])
    return (
        f"bbox.xmin BETWEEN {XMIN} AND {XMAX} "
        f"AND bbox.ymin BETWEEN {YMIN} AND {YMAX} "
        f"AND (categories.primary ILIKE '%grocery%' "
        f"OR categories.primary IN ('supermarket', 'wholesale_grocer', {rec_in}))"
    )


def discover(con):
    sql = f"""
      WITH src AS (
        SELECT categories.primary AS c
        FROM read_parquet('{PLACES}', hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {XMIN} AND {XMAX}
          AND bbox.ymin BETWEEN {YMIN} AND {YMAX}
      )
      SELECT c AS category, count(*) AS n
      FROM src
      WHERE {' OR '.join([f"c ILIKE '%{k}%'" for k in KEYWORDS])}
      GROUP BY 1 ORDER BY 2 DESC
    """
    print("Running discovery query (scanning GTA bbox)...", flush=True)
    rows = con.execute(sql).fetchall()
    print(f"\n{'category':40} count")
    print("-" * 50)
    for cat, n in rows:
        print(f"{(cat or '<null>'):40} {n}")
    print(f"\n{len(rows)} distinct candidate categories.")


def extract(con):
    sql = f"""
      SELECT
        id,
        names.primary                AS name,
        categories.primary           AS category,
        categories.alternate         AS alt_categories,
        ST_Y(geometry)               AS lat,
        ST_X(geometry)               AS lng,
        addresses[1].freeform        AS street,
        addresses[1].locality        AS city,
        addresses[1].postcode        AS postcode
      FROM read_parquet('{PLACES}', hive_partitioning=1)
      WHERE {where_clause()}
    """
    print("Running extract query (scanning GTA bbox)...", flush=True)
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    out = [dict(zip(cols, r)) for r in rows]
    # alt_categories is a duckdb list -> already a python list; ensure JSON-safe.
    for o in out:
        if o.get("alt_categories") is None:
            o["alt_categories"] = []
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"Wrote {len(out)} candidate POIs -> {os.path.relpath(OUT_FILE, os.getcwd())}")


def main():
    con = connect()
    if "--discover" in sys.argv:
        discover(con)
    else:
        extract(con)


if __name__ == "__main__":
    main()
