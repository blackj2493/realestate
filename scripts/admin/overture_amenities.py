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
  python scripts/admin/overture_amenities.py              # grocery/recreation raw candidates
  python scripts/admin/overture_amenities.py --transit    # transit-station raw candidates
"""
import json
import os
import sys
import duckdb

# Overture keeps only the two most recent releases on the public bucket -- 2026-05-20.0,
# which built the committed grocery/recreation rows, is GONE, so this script could not run
# at all until this was bumped. NOTE: re-running the grocery/recreation extract on a NEW
# release will move every listing's NearestGroceryKm/NearestRecCentreKm, because those rows
# can no longer be reproduced from their original source. The transit extract below is
# additive and carries no such risk.
RELEASE = "2026-08-19.0"
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
# Grocery = supermarket + grocery_store (the two categories holding the real chains;
# specialty/organic/ethnic/wholesale long-tail and farmers/flea markets excluded).
# Recreation = community_center only (sports_and_recreation_venue is ~78% noise —
# karting/trampoline/pickleball/etc. — and the catch-all community_services_non_profits
# is excluded). Final labelling happens in build-amenities-dataset.ts; this scopes the scan.
GROCERY_CATEGORIES = ("supermarket", "grocery_store")
REC_CATEGORIES = ("community_center",)

# Transit (--transit): passenger stations people name as a commute destination. Counts in
# the GTA bbox on release 2026-08-19.0: train_station 221, bus_station 144,
# light_rail_and_subway_stations 29, metro_station 15, public_transportation 12, trains 6,
# railway_service 1. `transportation` (766) is excluded -- it is the generic parent and
# sweeps in movers, couriers and driving schools.
#
# bus_station is ~70% noise (individual stops, platforms, garages, charter rental firms)
# but it is NOT excluded the way sports_and_recreation_venue was: it is the ONLY category
# holding Hamilton GO Centre, Milton GO Station, Mount Pleasant GO Station, Langstaff GO
# Station, Kennedy GO and Lincolnville GO Station. The noise is filtered downstream by name.
TRANSIT_CATEGORIES = (
    "train_station",
    "light_rail_and_subway_stations",
    "metro_station",
    "public_transportation",
    "bus_station",
    "trains",
    "railway_service",
)

TRANSIT_OUT_FILE = os.path.join(OUT_DIR, "overture-transit-raw.json")


def where_clause(categories) -> str:
    cats = ", ".join([f"'{c}'" for c in categories])
    return (
        f"bbox.xmin BETWEEN {XMIN} AND {XMAX} "
        f"AND bbox.ymin BETWEEN {YMIN} AND {YMAX} "
        f"AND categories.primary IN ({cats})"
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


def extract(con, categories=None, out_file=None):
    # `region` is selected for the transit pass and harmless for the others: the GTA bbox
    # reaches across the Niagara River, so a plain bbox filter also returns Buffalo,
    # Lockport and North Tonawanda (14 NY rows in the transit scan). Every row carries a
    # region, so the downstream ON filter is exact rather than a coordinate guess.
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
        addresses[1].region          AS region,
        addresses[1].postcode        AS postcode
      FROM read_parquet('{PLACES}', hive_partitioning=1)
      WHERE {where_clause(categories or (*GROCERY_CATEGORIES, *REC_CATEGORIES))}
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
    target = out_file or OUT_FILE
    with open(target, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"Wrote {len(out)} candidate POIs -> {os.path.relpath(target, os.getcwd())}")


def main():
    con = connect()
    if "--discover" in sys.argv:
        discover(con)
    elif "--transit" in sys.argv:
        extract(con, TRANSIT_CATEGORIES, TRANSIT_OUT_FILE)
    else:
        extract(con)


if __name__ == "__main__":
    main()
