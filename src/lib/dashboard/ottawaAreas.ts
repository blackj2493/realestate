/**
 * City-of-Ottawa area names — the members of the "Ottawa" dashboard region group.
 *
 * TRREB files Ottawa's inventory under ~51 OREB-style area names (Kanata, Barrhaven,
 * Orleans, Ottawa Centre, …) with NO single "Ottawa" City value and no string/code rule
 * to roll them up (CityRegion codes scatter 551–9404; see [[trreb-city-taxonomy]]). So the
 * group is an explicit, data-derived list: `areaFilter` expands the "Ottawa" region to
 * these City values (a big City:=… OR), giving a one-tap city-wide market — while any
 * SINGLE area below can still be added on its own via search for a focused per-area section.
 *
 * DERIVATION (reproduce with `npx tsx scripts/admin/derive-ottawa-cities.ts`): facet the
 * live `City` field within a 45 km radius of downtown Ottawa (45.4215, -75.6972), minus a
 * blocklist of the surrounding SEPARATE municipalities (Lanark / Renfrew / Prescott-Russell
 * / SDG / Grenville — Carleton Place, Russell, Mississippi Mills, …) and a few mis-geocoded
 * far-away outliers (North Bay, Collingwood, …). Last derived 2026-07-06: 51 areas ≈ 6,259
 * active listings. Refresh periodically — TRREB adds/renames areas; the derive script's
 * output is the source of truth, this array is the baked copy the sync filter reads.
 */
export const OTTAWA_AREAS: string[] = [
  "Alta Vista and Area",
  "Barrhaven",
  "Beacon Hill North - South and Area",
  "Belair Park - Copeland Park and Area",
  "Bells Corners and South to Fallowfield",
  "Billings Bridge - Riverside Park and Area",
  "Blackburn Hamlet",
  "Blossom Park - Airport and Area",
  "Britannia - Lincoln Heights and Area",
  "Britannia Heights - Queensway Terrace N and Area",
  "Carlington - Central Park",
  "Carlingwood - Westboro and Area",
  "Carlsbad Springs",
  "Carp - Dunrobin - Huntley - Fitzroy and Area",
  "Carp - Huntley Ward",
  "Cityview - Parkwoods Hills - Rideau Shore",
  "Constance Bay - Dunrobin - Kilmaurs - Woodlawn",
  "Country Place - Pineglen - Crestview and Area",
  "Crystal Bay - Rocky Point - Bayshore",
  "Cyrville - Carson Grove - Pineview",
  "Dows Lake - Civic Hospital and Area",
  "Elmvale Acres and Area",
  "Fallowfield Rd South of Ottawa",
  "Glebe - Ottawa East and Area",
  "Greely - Metcalfe - Osgoode - Vernon and Area",
  "Hunt Club - South Keys and Area",
  "Hunt Club - Windsor Park Village and Area",
  "Kanata",
  "Leitrim",
  "Lower Town - Sandy Hill",
  "Manor Park - Cardinal Glen and Area",
  "Manotick - Kars - Rideau Twp and Area",
  "McKellar Heights - Glabar Park and Area",
  "Meadowlands - Crestview and Area",
  "Mooneys Bay - Carleton Heights and Area",
  "New Edinburgh - Lindenlea",
  "Orleans - Convent Glen and Area",
  "Orleans - Cumberland and Area",
  "Ottawa Centre",
  "Overbrook - Castleheights and Area",
  "Parkway Park - Queensway Terrace S and Area",
  "Qualicum - Bruce Farm - Greenbelt and Area",
  "Rockcliffe Park",
  "South of Baseline to Knoxdale",
  "Stittsville - Munster - Richmond",
  "Tanglewood - Grenfell Glen - Pineglen",
  "Tunneys Pasture and Ottawa West",
  "Vanier and Kingsview Park",
  "West Centre Town",
  "Westboro - Hampton Park",
  "Woodroffe",
];
