-- 149: rental_market_index — uniq_rmi_tier must include living_area_range.
--
-- 148 added the size rungs and their lookup indexes but left the UNIQUENESS key alone.
-- That key is what the refresh upserts on, and it does not mention living_area_range —
-- so two nbhd_size cohorts that differ ONLY by size band collide:
--
--   Key (match_tier, basis, city_region, city, county, property_sub_type,
--        sub_type_family, bedrooms_total, bathrooms, bedrooms_above, den)
--   = (nbhd_size, closed_12, Mount Pleasant West, Toronto C10, , Condo Apartment, ,
--      2, 1, -1, -1) already exists.
--
-- The refresh TRUNCATES before it inserts, so the failed run left the table empty and
-- every rent estimate in production reading nothing. 148 should never have shipped
-- without this; the dry run cannot catch it because it writes nothing.
--
-- COALESCE to -1 matches the idiom the existing key already uses for bathrooms,
-- bedrooms_above and den: NULL means "this rung does not key on it", and NULL is not
-- distinct-equal in a btree unique index.
DROP INDEX IF EXISTS uniq_rmi_tier;

CREATE UNIQUE INDEX uniq_rmi_tier ON public.rental_market_index USING btree (
  match_tier,
  basis,
  COALESCE(city_region, ''::text),
  COALESCE(city, ''::text),
  COALESCE(county, ''::text),
  COALESCE(property_sub_type, ''::text),
  COALESCE(sub_type_family, ''::text),
  bedrooms_total,
  COALESCE(bathrooms, '-1'::integer),
  COALESCE(bedrooms_above, '-1'::integer),
  COALESCE((den)::integer, '-1'::integer),
  COALESCE(living_area_range, '-1'::integer)
);
