-- 130: street_recap RPCs — the monthly owner email's aggregates.
--
-- WHY RPCs AND NOT PostgREST. Every figure the recap prints is a GROUP BY: sales per
-- neighbourhood, median days-to-sell, share above asking, the property-type split. PostgREST
-- cannot express those, and fetching the rows to aggregate in JS means ~32,000 sales a month
-- province-wide through a client whose default cap is 1000 rows — the exact silent-truncation
-- trap that has already manufactured one false alarm in this codebase. One round trip per
-- grain, computed in the database, is both correct and cheaper.
--
-- THREE TRAPS ENCODED HERE, all of them found the hard way:
--
--   1. `transaction_type` holds 'For Sale' and 'For Lease', NOT 'Sale'. Filtering on the
--      wrong literal returns zero rows and looks like a quiet market. Worse, omitting the
--      filter averages houses together with rentals.
--   2. `listings.standard_status` holds MLS EVENT names ('new', 'price change', 'sold'),
--      so there is no 'Active' value to filter on. Active means "not in the terminal set",
--      which is what TERMINAL below encodes.
--   3. `full_payload` is never touched. Detoasting it across the whole table is what broke
--      Toronto before; the flat columns (migration 071 and after) exist precisely so these
--      reads stay cheap. That is also why FSA is unavailable for actives — the postal code
--      lives only in the payload — and the caller falls back to the city for that line.
--
-- THE WINDOW IS AN EXPLICIT [p_from, p_to) RANGE OF DATES, not a rolling day count and not
-- timestamps. Two reasons. A rolling 30 days run on the 2nd describes mostly August while
-- calling itself September. And `close_date` is a `date`: compared against a timestamptz it
-- is cast to midnight in the SERVER timezone, so a 05:00Z bound (midnight Toronto in EST)
-- silently excludes the 1st of every month through EDT. Dates on both sides removes the
-- timezone from the comparison, which is correct anyway — a closing is a calendar date.
--
-- The scope key is whatever the caller asked to group by, echoed back so a single call can
-- serve many recipients at once: the worker collects every distinct neighbourhood across the
-- whole audience and asks once.
--
-- SECURITY. Plain functions, invoked by the service role from the worker. They read
-- raw_vow_sold and listings, so they are never granted to anon or authenticated.

-- ── Sold aggregates ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.street_recap_sold(
  p_scope text,
  p_keys  text[],
  p_from  date,
  p_to    date
)
RETURNS TABLE (
  scope_key    text,
  city         text,
  sales        bigint,
  above_asking bigint,
  median_dom   numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE p_scope
      WHEN 'region' THEN s.city_region
      WHEN 'fsa'    THEN upper(substring(s.postal_code from 1 for 3))
      ELSE               s.city
    END                                                          AS scope_key,
    min(s.city)                                                  AS city,
    count(*)                                                     AS sales,
    count(*) FILTER (WHERE s.close_price > s.list_price)          AS above_asking,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.days_on_market)::numeric, 0) AS median_dom
  FROM raw_vow_sold s
  WHERE s.transaction_type = 'For Sale'          -- NOT 'Sale'; see trap 1
    AND s.close_date >= p_from
    AND s.close_date <  p_to
    AND s.close_price > 0
    AND s.list_price  > 0
    AND CASE p_scope
          WHEN 'region' THEN lower(s.city_region)
          WHEN 'fsa'    THEN lower(substring(s.postal_code from 1 for 3))
          ELSE               lower(s.city)
        END = ANY (SELECT lower(k) FROM unnest(p_keys) AS k)
  -- No HAVING needed to exclude a null neighbourhood: `lower(NULL) = ANY(...)` is NULL,
  -- so those rows never survive the WHERE in the first place.
  GROUP BY 1;
$$;

-- ── The property-type split ──────────────────────────────────────────────────
-- Kept separate rather than aggregated into JSON: the caller filters it by its own
-- MIN_SALES floor and caps it at three rows, so returning the long tail costs nothing and
-- keeps the floor in one place (payload.ts) instead of two.
CREATE OR REPLACE FUNCTION public.street_recap_sold_types(
  p_scope text,
  p_keys  text[],
  p_from  date,
  p_to    date
)
RETURNS TABLE (
  scope_key         text,
  property_sub_type text,
  sales             bigint,
  median_dom        numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE p_scope
      WHEN 'region' THEN s.city_region
      WHEN 'fsa'    THEN upper(substring(s.postal_code from 1 for 3))
      ELSE               s.city
    END                        AS scope_key,
    btrim(s.property_sub_type) AS property_sub_type,
    count(*)                   AS sales,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.days_on_market)::numeric, 0) AS median_dom
  FROM raw_vow_sold s
  WHERE s.transaction_type = 'For Sale'
    AND s.close_date >= p_from
    AND s.close_date <  p_to
    AND s.close_price > 0
    AND s.list_price  > 0
    AND s.property_sub_type IS NOT NULL
    AND btrim(s.property_sub_type) <> ''
    AND CASE p_scope
          WHEN 'region' THEN lower(s.city_region)
          WHEN 'fsa'    THEN lower(substring(s.postal_code from 1 for 3))
          ELSE               lower(s.city)
        END = ANY (SELECT lower(k) FROM unnest(p_keys) AS k)
  GROUP BY 1, 2;
$$;

-- ── Standing inventory ───────────────────────────────────────────────────────
-- 'region' or 'city' only. FSA is deliberately unsupported: the postal code lives in
-- full_payload and detoasting it across the table is the read this codebase has been
-- burned by. The caller falls back to the city for this line, which is honest — the copy
-- names the area it is describing.
CREATE OR REPLACE FUNCTION public.street_recap_actives(
  p_scope text,
  p_keys  text[]
)
RETURNS TABLE (
  scope_key        text,
  active           bigint,
  cut_price        bigint,
  median_true_dom  numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE p_scope WHEN 'region' THEN l.city_region ELSE l.city END AS scope_key,
    count(*)                                                      AS active,
    count(*) FILTER (WHERE COALESCE(l.total_price_drop, 0) > 0)    AS cut_price,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.true_dom)::numeric, 0) AS median_true_dom
  FROM listings l
  WHERE lower(COALESCE(l.standard_status, '')) <> ALL (ARRAY[    -- see trap 2
          'sold','closed','closed sale','leased','terminated','expired','suspended'
        ])
    AND COALESCE(l.is_orphaned, false) = false
    AND l.list_price >= 50000
    AND CASE p_scope WHEN 'region' THEN lower(l.city_region) ELSE lower(l.city) END
        = ANY (SELECT lower(k) FROM unnest(p_keys) AS k)
  GROUP BY 1;
$$;

COMMENT ON FUNCTION public.street_recap_sold(text, text[], date, date) IS
  'Monthly Street Recap: sold counts, above-asking counts and median DOM, grouped by neighbourhood / FSA / city. transaction_type = ''For Sale'' only.';
COMMENT ON FUNCTION public.street_recap_actives(text, text[]) IS
  'Monthly Street Recap: standing inventory, price-cut share and median true DOM. Active = NOT in the terminal status set; no full_payload read, so FSA is unsupported here.';
