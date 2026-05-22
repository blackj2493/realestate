/**
 * Unit checks for the deterministic condition scorers.
 * Run: npx.cmd tsx scripts/worker/test-condition-scoring.ts
 */

import {
  deriveInteriorTier,
  deriveExteriorTier,
  deriveBasementTier,
} from '@/lib/avm/conditionScoring';

let pass = 0;
let fail = 0;

function eq(name: string, got: number, want: number) {
  if (got === want) {
    pass++;
    console.log(`  ✅ ${name} = ${got}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}: got ${got}, want ${want}`);
  }
}

console.log('Basement:');
eq('Apartment + Separate Entrance', deriveBasementTier({ Basement: ['Apartment', 'Separate Entrance'] }), 1);
eq('Finished + Walk-Out', deriveBasementTier({ Basement: ['Finished', 'Walk-Out'] }), 1);
eq('Finished with Walk-Out (single token)', deriveBasementTier({ Basement: ['Finished with Walk-Out'] }), 1);
eq('Finished + Walk-Up', deriveBasementTier({ Basement: ['Finished', 'Walk-Up'] }), 2);
eq('Full + Finished', deriveBasementTier({ Basement: ['Full', 'Finished'] }), 3);
eq('Partially Finished', deriveBasementTier({ Basement: ['Partially Finished'] }), 5);
eq('Full + Unfinished', deriveBasementTier({ Basement: ['Full', 'Unfinished'] }), 7);
eq('Crawl Space', deriveBasementTier({ Basement: ['Crawl Space'] }), 8);
eq('None', deriveBasementTier({ Basement: ['None'] }), 9);
eq('empty array', deriveBasementTier({ Basement: [] }), 9);
eq('missing field', deriveBasementTier({}), 9);

console.log('\nInterior (centered: typical → 3, premium → 2/1):');
eq('luxury (sauna+inlaw+vac+oven+carpetfree)', deriveInteriorTier({ InteriorFeatures: ['Sauna', 'In-Law Suite', 'Central Vacuum', 'Built-In Oven', 'Carpet Free'] }), 1);
eq('two amenities (oven+vac)', deriveInteriorTier({ InteriorFeatures: ['Built-In Oven', 'Central Vacuum'] }), 2);
eq('CSV string (sauna,central vac)', deriveInteriorTier({ InteriorFeatures: 'Sauna, Central Vac' }), 2);
eq('present but non-premium → neutral', deriveInteriorTier({ InteriorFeatures: ['Other', 'Floor Drain'] }), 3);
eq('water systems capped at +2', deriveInteriorTier({ InteriorFeatures: ['On Demand Water Heater', 'ERV', 'Water Purifier', 'Water Softener'] }), 2);
eq('no data → neutral', deriveInteriorTier({}), 3);

console.log('\nExterior (centered: plain brick → 3):');
eq('plain brick → neutral', deriveExteriorTier({ ConstructionMaterials: ['Brick'] }), 3);
eq('brick + deck + patio', deriveExteriorTier({ ConstructionMaterials: ['Brick'], ExteriorFeatures: ['Deck', 'Patio'] }), 3);
eq('VOW example (stone + 3 outdoor + garage)', deriveExteriorTier({ ConstructionMaterials: ['Brick', 'Stone'], ExteriorFeatures: ['Awnings', 'Landscaped', 'Patio', 'Porch', 'Private Pond'], CoveredSpaces: 2 }), 2);
eq('stone + inground pool + hot tub', deriveExteriorTier({ ConstructionMaterials: ['Stone'], PoolFeatures: ['Inground'], ExteriorFeatures: ['Hot Tub'] }), 1);
eq('inground salt pool + hot tub + deck on vinyl', deriveExteriorTier({ ConstructionMaterials: ['Vinyl Siding'], PoolFeatures: ['Inground', 'Salt'], ExteriorFeatures: ['Hot Tub', 'Deck'] }), 2);
eq('above-ground pool only on vinyl', deriveExteriorTier({ ConstructionMaterials: ['Vinyl Siding'], PoolFeatures: ['Above Ground'] }), 4);
eq('plain vinyl, nothing', deriveExteriorTier({ ConstructionMaterials: ['Vinyl Siding'] }), 5);
eq('no data → neutral', deriveExteriorTier({}), 3);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
