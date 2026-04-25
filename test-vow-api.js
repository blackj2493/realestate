// Test script to fetch property from VOW API
// Run with: node test-vow-api.js

// Simulate environment loading
process.env.PROPTX_VOW_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZXMiOlsiQW1wVmVuZG9yIl0sImlzcyI6InByb2QuYW1wcmUuY2EiLCJleHAiOjI1MzQwMjMwMDc5OSwiaWF0IjoxNzMzNTQyNDI2LCJzdWJqZWN0VHlwZSI6InZlbmRvciIsInN1YmplY3RLZXkiOiI2OTU4IiwianRpIjoiYjg0ZGYwOTUyNDk4NmFkMiIsImN1c3RvbWVyTmFtZSI6InRycmViIn0.q9UI-ib_A3Qu_B8dSO8iQwvz2tRB_qu-ZOrS3tUO3ig";
process.env.AMPRE_API_URL = "https://query.ampre.ca/odata";

// VOW API Client (simplified inline version)
class ProptXClient {
  constructor(accessToken, tokenType = 'VOW') {
    this.accessToken = accessToken;
    this.tokenType = tokenType;
    this.apiBaseUrl = process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata';
  }

  async request(endpoint, params) {
    const url = new URL(`${this.apiBaseUrl}${endpoint}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value) url.searchParams.append(key, value);
      });
    }

    console.log(`\n📡 Request URL: ${url.toString().substring(0, 100)}...`);
    
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: response.statusText } }));
      throw new Error(error.error?.message || `API Error: ${response.status}`);
    }

    return response.json();
  }

  async getProperties(params) {
    return this.request('/Property', params);
  }

  async searchByCity(city, options) {
    const params = {
      $filter: `contains(City,'${city}')`,
      ...options,
    };
    return this.request('/Property', params);
  }

  async getProperty(listingKey) {
    return this.request(`/Property('${listingKey}')`);
  }

  async getMedia(listingKey, options) {
    const params = {
      $filter: `ResourceRecordKey eq '${listingKey}'`,
      $orderby: 'Order asc',
      ...options,
    };
    return this.request('/Media', params);
  }

  async getRooms(listingKey) {
    const params = {
      $filter: `ListingKey eq '${listingKey}'`,
      $orderby: 'Order asc',
    };
    return this.request('/PropertyRooms', params);
  }

  async getOpenHouses(options) {
    return this.request('/OpenHouse', options);
  }
}

// Helper function to safely join array fields
function safeJoin(value, separator = ', ') {
  if (Array.isArray(value)) return value.join(separator);
  if (value) return String(value);
  return null;
}

function formatPrice(value) {
  if (!value && value !== 0) return 'N/A';
  return `$${Number(value).toLocaleString()}`;
}

function createVowClient(accessToken) {
  return new ProptXClient(accessToken, 'VOW');
}

async function fetchPropertyDetails() {
  console.log('🔌 Connecting to VOW API...\n');
  console.log('Token Type: VOW');
  console.log('API Endpoint: https://query.ampre.ca/odata\n');
  
  const VOW_TOKEN = process.env.PROPTX_VOW_TOKEN;
  
  try {
    const client = createVowClient(VOW_TOKEN);
    console.log('✓ VOW Client created successfully\n');
    
    // Search for properties in Oakville (the listing is from the example URL)
    console.log('📍 Searching for properties in Oakville...\n');
    
    const oakvilleResults = await client.searchByCity('Oakville', { $top: 3 });
    console.log(`✓ Found ${oakvilleResults.value.length} properties in Oakville\n`);
    
    // Show first 2 properties with full details
    const displayProps = oakvilleResults.value.slice(0, 2);
    
    for (const prop of displayProps) {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('📋 PROPERTY DATA');
      console.log('═══════════════════════════════════════════════════════════════\n');
      
      console.log('📌 Basic Info:');
      console.log('  ListingKey:', prop.ListingKey || 'N/A');
      console.log('  ListingId:', prop.ListingId || 'N/A');
      console.log('  Status:', prop.StandardStatus || prop.MlsStatus || 'N/A');
      console.log('  Property Type:', prop.PropertyType || 'N/A');
      console.log('  Property Sub-Type:', prop.PropertySubType || 'N/A');
      
      console.log('\n📍 Location:');
      console.log('  Full Address:', prop.UnparsedAddress || 'N/A');
      console.log('  Street:', `${prop.StreetNumber || ''} ${prop.StreetName || ''} ${prop.StreetSuffix || ''}`.trim() || 'N/A');
      console.log('  Unit:', prop.UnitNumber || prop.ApartmentNumber || 'N/A');
      console.log('  City:', prop.City || 'N/A');
      console.log('  Region:', prop.CityRegion || prop.Township || 'N/A');
      console.log('  Province:', prop.StateOrProvince || 'N/A');
      console.log('  Postal Code:', prop.PostalCode || 'N/A');
      console.log('  County:', prop.CountyOrParish || 'N/A');
      console.log('  Cross Street:', prop.CrossStreet || 'N/A');
      
      console.log('\n💰 Price:');
      console.log('  List Price:', prop.ListPrice ? `$${prop.ListPrice.toLocaleString()}` : 'N/A');
      console.log('  Original Price:', prop.OriginalListPrice ? `$${prop.OriginalListPrice.toLocaleString()}` : 'N/A');
      console.log('  Close Price:', prop.ClosePrice ? `$${prop.ClosePrice.toLocaleString()}` : 'N/A');
      console.log('  Price Unit:', prop.ListPriceUnit || 'N/A');
      console.log('  Price Change Date:', prop.PriceChangeTimestamp || 'N/A');
      
      console.log('\n🏠 Building Details:');
      console.log('  Bedrooms Total:', prop.BedroomsTotal || 'N/A');
      console.log('  Bedrooms Above Grade:', prop.BedroomsAboveGrade || 'N/A');
      console.log('  Bedrooms Below Grade:', prop.BedroomsBelowGrade || 'N/A');
      console.log('  Bathrooms:', prop.BathroomsTotalInteger || 'N/A');
      console.log('  Kitchens:', prop.KitchensTotal || 'N/A');
      console.log('  Rooms Total:', prop.RoomsTotal || 'N/A');
      console.log('  Living Area:', prop.LivingAreaRange || 'N/A');
      console.log('  Building Area:', prop.BuildingAreaTotal ? `${prop.BuildingAreaTotal} ${prop.BuildingAreaUnits || 'sq ft'}` : 'N/A');
      
      console.log('\n🚗 Parking:');
      console.log('  Parking Spaces:', prop.ParkingTotal || prop.ParkingSpaces || 'N/A');
      console.log('  Garage:', prop.GarageYN ? 'Yes' : 'No');
      console.log('  Garage Type:', Array.isArray(prop.GarageType) ? prop.GarageType.join(', ') : (prop.GarageType || 'N/A'));
      console.log('  Garage Spaces:', prop.GarageParkingSpaces || 'N/A');
      console.log('  Parking Type:', Array.isArray(prop.ParkingType1) ? prop.ParkingType1.join(', ') : (prop.ParkingType1 || 'N/A'));
      console.log('  Covered Spaces:', prop.CoveredSpaces || 'N/A');
      
      console.log('\n🌡️ Utilities:');
      console.log('  Heating:', safeJoin(prop.HeatType) || (prop.HeatingYN ? 'Yes' : 'N/A'));
      console.log('  Cooling:', safeJoin(prop.Cooling) || (prop.CoolingYN ? 'Yes' : 'N/A'));
      console.log('  Water Source:', safeJoin(prop.WaterSource) || 'N/A');
      console.log('  Sewer:', safeJoin(prop.Sewer) || 'N/A');
      
      console.log('\n🔥 Interior Features:');
      console.log('  Fireplace:', prop.FireplaceYN ? 'Yes' : 'No');
      console.log('  Fireplaces:', prop.FireplacesTotal || 'N/A');
      console.log('  Fireplace Features:', safeJoin(prop.FireplaceFeatures) || 'N/A');
      console.log('  Laundry Level:', prop.LaundryLevel || 'N/A');
      console.log('  Elevator:', prop.ElevatorYN ? 'Yes' : 'N/A');
      
      console.log('\n🏚️ Basement:');
      console.log('  Basement:', prop.BasementYN ? 'Yes' : 'No');
      console.log('  Basement Type:', safeJoin(prop.Basement) || 'N/A');
      console.log('  Den/Family Room:', prop.DenFamilyroomYN ? 'Yes' : 'N/A');
      console.log('  Recreation Room:', prop.RecreationRoomYN ? 'Yes' : 'N/A');
      
      console.log('\n🏡 Exterior & Land:');
      console.log('  Lot Size:', prop.LotSizeArea ? `${prop.LotSizeArea} ${prop.LotSizeUnits || prop.LotSizeAreaUnits || 'acres'}` : 'N/A');
      console.log('  Lot Features:', safeJoin(prop.LotFeatures) || 'N/A');
      console.log('  Lot Shape:', prop.LotShape || 'N/A');
      console.log('  Frontage:', prop.FrontageLength || 'N/A');
      console.log('  Exterior Finish:', safeJoin(prop.ExteriorFinish) || 'N/A');
      console.log('  Exterior Features:', safeJoin(prop.ExteriorFeatures) || 'N/A');
      console.log('  Fencing:', prop.Fencing || 'N/A');
      console.log('  Pool:', safeJoin(prop.PoolType) || safeJoin(prop.PoolFeatures) || 'N/A');
      console.log('  Waterfront:', prop.WaterfrontYN ? 'Yes' : 'No');
      
      console.log('\n📅 Dates & Status:');
      console.log('  Listing Date:', prop.ListingContractDate || 'N/A');
      console.log('  Expiration:', prop.ExpirationDate || 'N/A');
      console.log('  Possession Date:', prop.PossessionDate || 'N/A');
      console.log('  Possession Type:', prop.PossessionType || 'N/A');
      console.log('  Days on Market:', prop.DaysOnMarket || 'N/A');
      console.log('  Last Modified:', prop.ModificationTimestamp || prop.SystemModificationTimestamp || 'N/A');
      
      console.log('\n💼 Listing Info:');
      console.log('  Listing Office:', prop.ListOfficeName || 'N/A');
      console.log('  Listing Agent:', prop.ListAgentFullName || 'N/A');
      console.log('  Co-Listing Office:', prop.CoListOfficeName || 'N/A');
      console.log('  Broker Fax:', prop.BrokerFaxNumber || 'N/A');
      console.log('  Source:', prop.OriginatingSystemName || prop.SourceSystemName || 'N/A');
      
      console.log('\n📝 Remarks:');
      console.log('  Public Remarks:', prop.PublicRemarks ? (prop.PublicRemarks.length > 200 ? prop.PublicRemarks.substring(0, 200) + '...' : prop.PublicRemarks) : 'N/A');
      console.log('  Inclusions:', prop.Inclusions || 'N/A');
      console.log('  Exclusions:', prop.Exclusions || 'N/A');
      
      console.log('\n💵 Tax & Fees:');
      console.log('  Annual Taxes:', prop.TaxAnnualAmount ? `$${prop.TaxAnnualAmount.toLocaleString()}` : 'N/A');
      console.log('  Tax Year:', prop.TaxYear || 'N/A');
      console.log('  Assessed Value:', prop.TaxAssessedValue ? `$${prop.TaxAssessedValue.toLocaleString()}` : 'N/A');
      console.log('  Maintenance:', prop.MaintenanceExpense ? `$${prop.MaintenanceExpense}/mo` : 'N/A');
      console.log('  Association Fee:', prop.AssociationFee ? `$${prop.AssociationFee}/mo` : 'N/A');
      console.log('  Association Fee Includes:', prop.AssociationFeeIncludes ? prop.AssociationFeeIncludes.join(', ') : 'N/A');
      
      console.log('\n🏢 Condo/Amenities:');
      console.log('  Association:', prop.AssociationYN ? 'Yes' : 'No');
      console.log('  Association Name:', prop.AssociationName || 'N/A');
      console.log('  Condo Corp #:', prop.CondoCorpNumber || 'N/A');
      console.log('  Locker:', prop.Locker || 'N/A');
      console.log('  Amenities:', prop.Amenities ? prop.Amenities.join(', ') : 'N/A');
      console.log('  Community Features:', prop.CommunityFeatures ? prop.CommunityFeatures.join(', ') : 'N/A');
      
      console.log('\n📋 Room Details:');
      // Fetch and display rooms
      try {
        const rooms = await client.getRooms(prop.ListingKey);
        if (rooms.value && rooms.value.length > 0) {
          rooms.value.forEach((r, i) => {
            console.log(`  ${i + 1}. ${r.RoomType ? r.RoomType.join(', ') : 'Room'} - Level: ${r.RoomLevel ? r.RoomLevel.join(', ') : 'N/A'} - ${r.RoomDimensions || `${r.RoomWidth || ''}x${r.RoomLength || ''}`}`.trim());
          });
        } else {
          console.log('  No room details available');
        }
      } catch (e) {
        console.log('  Room details not available');
      }
      
      console.log('\n🖼️ Media:');
      // Fetch and display media
      try {
        const media = await client.getMedia(prop.ListingKey);
        if (media.value && media.value.length > 0) {
          console.log(`  Total Media Items: ${media.value.length}`);
          media.value.slice(0, 5).forEach((m, i) => {
            console.log(`  ${i + 1}. [${m.MediaCategory || 'Photo'}] ${m.MediaURL ? (m.MediaURL.length > 80 ? m.MediaURL.substring(0, 80) + '...' : m.MediaURL) : 'N/A'}`);
            if (m.PreferredPhotoYN) console.log(`     ⭐ Preferred Photo`);
          });
        } else {
          console.log('  No media available');
        }
      } catch (e) {
        console.log('  Media not available');
      }
      
      console.log('\n📋 RAW JSON DATA:');
      console.log(JSON.stringify(prop, null, 2));
      console.log('\n');
    }
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ VOW API TEST COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    return true;
  } catch (error) {
    console.error('\n❌ VOW API Error:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Full error:', error);
    return false;
  }
}

fetchPropertyDetails().then((success) => {
  process.exit(success ? 0 : 1);
});
