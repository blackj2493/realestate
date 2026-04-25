// Canadian cities for property search
// Extracted from Ontario real estate areas

export interface CityOption {
  name: string;
  regions?: string[];
}

export interface AreaOption {
  city: string;
  municipalities: CityOption[];
}

// Main areas (counties/regions)
export const AREAS: AreaOption[] = [
  { city: "ALGOMA", municipalities: [] },
  { city: "BRANT", municipalities: [] },
  { city: "BRANTFORD", municipalities: [] },
  { city: "BRUCE", municipalities: [] },
  { city: "DURHAM", municipalities: [] },
  { city: "GREY COUNTY", municipalities: [] },
  { city: "HALTON", municipalities: [] },
  { city: "HAMILTON", municipalities: [] },
  { city: "HURON", municipalities: [] },
  { city: "KAWARTHA LAKES", municipalities: [] },
  { city: "LAMBTON", municipalities: [] },
  { city: "LEEDS AND GRENVILLE", municipalities: [] },
  { city: "LENNOX AND ADDINGTON", municipalities: [] },
  { city: "MIDDLESEX", municipalities: [] },
  { city: "MUSKOKA", municipalities: [] },
  { city: "NIAGARA", municipalities: [] },
  { city: "NORFOLK", municipalities: [] },
  { city: "NORTHUMBERLAND", municipalities: [] },
  { city: "OXFORD", municipalities: [] },
  { city: "OTTAWA", municipalities: [] },
  { city: "PEEL", municipalities: [] },
  { city: "PERTH", municipalities: [] },
  { city: "PETERBOROUGH", municipalities: [] },
  { city: "PRESCOTT AND RUSSELL", municipalities: [] },
  { city: "PRINCE EDWARD", municipalities: [] },
  { city: "SIMCOE", municipalities: [] },
  { city: "STORMONT, DUNDAS AND GLENGARRY", municipalities: [] },
  { city: "TORONTO", municipalities: [] },
  { city: "WATERLOO", municipalities: [] },
  { city: "WELLINGTON", municipalities: [] },
  { city: "YORK", municipalities: [] },
];

// All unique cities/municipalities for dropdown
export const CITIES: CityOption[] = [
  // Algoma
  { name: "Algoma Remote Area" },
  { name: "Blind River" },
  { name: "Bruce Mines" },
  { name: "Dubreuilville" },
  { name: "Elliot Lake" },
  { name: "First Nations" },
  { name: "Hilton" },
  { name: "Hilton Beach" },
  { name: "Hornepayne" },
  { name: "Huron Shores" },
  { name: "Jocelyn" },
  { name: "Johnson" },
  { name: "Laird" },
  { name: "Macdonald, Meredith & Aberdeen Add'l" },
  { name: "Plummer Additional" },
  { name: "Prince" },
  { name: "Sault Ste Marie" },
  { name: "Spanish" },
  { name: "St. Joseph" },
  { name: "Tarbutt & Tarbutt Additional" },
  { name: "The North Shore" },
  { name: "Thessalon" },
  { name: "Wawa" },
  { name: "White River" },
  
  // Brant
  { name: "Brant", regions: ["Brantford Twp", "Burford", "Oakland", "Paris", "South Dumfries"] },
  
  // Brantford
  { name: "Brantford" },
  
  // Bruce
  { name: "Arran-Elderslie", regions: ["Arran-Elderslie"] },
  { name: "Brockton", regions: ["Brockton"] },
  { name: "Huron-Kinloss", regions: ["Huron-Kinloss", "Lucknow"] },
  { name: "Kincardine", regions: ["Kincardine"] },
  { name: "Northern Bruce Peninsula", regions: ["Northern Bruce Peninsula"] },
  { name: "Saugeen Shores", regions: ["Saugeen Shores"] },
  { name: "South Bruce", regions: ["South Bruce"] },
  { name: "South Bruce Peninsula", regions: ["South Bruce Peninsula"] },
  
  // Durham
  { name: "Ajax", regions: ["Central", "Central East", "Central West", "Northeast Ajax", "Northwest Ajax", "South East", "South West"] },
  { name: "Brock", regions: ["Beaverton", "Cannington", "Rural Brock", "Sunderland"] },
  { name: "Clarington", regions: ["Bowmanville", "Courtice", "Newcastle", "Orono", "Rural Clarington"] },
  { name: "Oshawa", regions: ["Beaton", "Centennial", "Central", "Columbus", "Donevan", "Eastdale", "Farewell", "Kedron", "Lakeview", "McLaughlin", "Northglen", "Northwood", "O'Neill", "Pinecrest", "Raglan", "Rural Oshawa", "Samac", "Stevenson Taunton", "Vanier", "Windfields"] },
  { name: "Pickering", regions: ["Amberlea", "Bay Ridges", "Brock Industrial", "Brock Ridge", "Duffin Heights", "Dunbarton", "Highbush", "Liverpool", "Rosebank", "Rouge Park", "Rougemount", "Rural Pickering", "Town Centre", "Village East", "West Shore", "Woodlands"] },
  { name: "Scugog", regions: ["Blackstock", "Port Perry", "Rural Scugog"] },
  { name: "Scugog 34", regions: ["Scugog First Nations"] },
  { name: "Uxbridge", regions: ["Rural Uxbridge", "Uxbridge"] },
  { name: "Whitby", regions: ["Blue Grass Meadows", "Brooklin", "Downtown Whitby", "Lynde Creek", "Port Whitby", "Pringle Creek", "Rolling Acres", "Rural Whitby", "Taunton North", "Whitby Industrial", "Williamsburg"] },
  
  // Grey County
  { name: "Blue Mountains", regions: ["Blue Mountain Resort Area", "Blue Mountains", "Rural Blue Mountains", "Thornbury"] },
  { name: "Chatsworth", regions: ["Chatsworth", "Rural Chatsworth"] },
  { name: "Georgian Bluffs", regions: ["Georgian Bluffs", "Rural Georgian Bluffs"] },
  { name: "Grey Highlands", regions: ["Flesherton", "Grey Highlands", "Markdale", "Priceville", "Rural Grey Highlands"] },
  { name: "Hanover", regions: ["Hanover"] },
  { name: "Meaford", regions: ["Meaford", "Rural Meaford"] },
  { name: "Owen Sound", regions: ["Owen Sound"] },
  { name: "Southgate", regions: ["Dundalk", "Rural Southgate", "Southgate"] },
  { name: "West Grey", regions: ["Ayton", "Durham", "Neustadt", "Rural West Grey", "West Grey"] },
  
  // Halton
  { name: "Burlington", regions: ["Alton", "Appleby", "Bayview", "Brant", "Brant Hills", "Bronte Creek", "Freeman", "Grindstone", "Headon", "Industrial Burlington", "LaSalle", "Mountainside", "Orchard", "Palmer", "Rose", "Roseland", "Rural Burlington", "Shoreacres", "Tansley", "Tyandaga", "Uptown"] },
  { name: "Halton Hills", regions: ["Acton", "Georgetown", "Glen Williams"] },
  { name: "Milton", regions: ["Beaty", "Bowes", "Bronte Meadows", "Brookville", "Campbellville", "Clarke", "Coates", "Cobban", "Dempsey", "Derry Green Business Park", "Dorset Park", "Esquesing", "Ford", "Harrison", "Milton Heights", "Moffat", "Mountain View", "Nassagaweya", "Nelson", "Old Milton", "Rural Milton West", "Scott", "Timberlea", "Trafalgar", "Walker", "Willmott"] },
  { name: "Oakville", regions: ["Bronte East", "Bronte West", "Clearview", "Eastlake", "Glen Abbey", "Iroquois Ridge North", "Iroquois Ridge South", "Old Oakville", "Palermo West", "River Oaks", "Rural Oakville", "Uptown Core", "West Oak Trails", "Winston Park"] },
  
  // Hamilton
  { name: "Hamilton", regions: ["Ainslie Wood", "Airport Employment Area", "Albion Falls", "Allison", "Ancaster", "Balfour", "Barnstown", "Bartonville", "Beasley", "Berrisfield", "Binbrook", "Blakeley", "Bonnington", "Broughton", "Bruleville", "Buchanan", "Burkholme", "Butler", "Carlisle", "Carpenter", "Central", "Chedoke Park", "Chappel", "Confederation Park", "Cootes Paradise", "Corktown", "Corman", "Crerar", "Crown Point", "Delta", "Dundas", "Dundurn", "Durand", "Eastmount", "Eleanor", "Falkirk", "Fessenden", "Freelton", "Fruitland", "Gershome", "Gibson", "Gilbert", "Gilkson", "Glenview", "Gourley", "Grayside", "Greenford", "Greeningdon", "Greensville", "Gurnett", "Hamilton Beach", "Hampton Heights", "Hannon", "Hill Park", "Homeside", "Huntington", "Inch Park", "Industrial Sector", "Iroquoia Heights", "Jerome", "Jerseyville", "Kennedy", "Kentley", "Kernighan", "King's Forest Lower", "King's Forest Upper", "Kirkendall", "Lakely", "Lakeshore", "Landsdale", "Lawfield", "Lisgar", "Lynden", "Macassa", "McQuesten", "Meadowlands", "Mewburn", "Mohawk", "Mount Hope", "Mountview", "Nashdale", "Normanhurst", "North End", "Orkney", "Parkview", "Pleasant View", "Quinndale", "Raleigh", "Randall", "Red Hill", "Riverdale", "Rockton", "Rolston", "Rosedale", "Rural Ancaster", "Rural Dundas", "Rural Flamborough", "Rural Glanbrook", "Rural Stoney Creek", "Rushdale", "Rycksmans", "Rymal", "Sheldon", "Sherwood", "Southam", "St. Clair", "Stinson", "Stipley", "Stoney Creek", "Stoney Creek Industrial", "Stoney Creek Mountain", "Strathcona", "Sunninghill", "Templemead", "Thorner", "Trenholme", "Twenty Place", "Villages of Glancaster", "Vincent", "Waterdown", "Westcliffe", "Westdale", "Winona", "Winona Park", "Woodburn", "Yeoville"] },
  
  // Huron
  { name: "Ashfield-Colborne-Wawanosh", regions: ["Ashfield Twp", "Belfast", "Colborne Twp", "Kingsbridge", "Kintail", "Lucknow", "Port Albert", "Saltford", "Sheppardton", "St. Helens", "West Wawanosh Twp"] },
  { name: "North Huron", regions: ["Auburn", "Blyth", "East Wawanosh Twp", "Whitechurch", "Wingham"] },
  { name: "Morris-Turnberry", regions: ["Belgrave", "Bluevale", "Blyth", "Morris Twp", "Turnberry Twp"] },
  { name: "Howick", regions: ["Howick Twp"] },
  { name: "Goderich", regions: ["Goderich Town"] },
  { name: "Central Huron", regions: ["Clinton", "Goderich Twp", "Holmesville", "Hullett Twp", "Londesborough"] },
  { name: "Huron East", regions: ["Brucefield", "Brussels", "Cranbrook", "Egmondville", "Grey Twp", "Harpurhey Village", "Kippen", "McKillop Twp", "Seaforth", "Tuckersmith Twp", "Vanastra", "Walton"] },
  { name: "Bluewater", regions: ["Bayfield", "Dashwood", "Hay Twp", "Hensall", "St. Joseph", "Stanley Twp", "Varna", "Zurich"] },
  { name: "South Huron", regions: ["Centralia", "Corbett", "Crediton", "Dashwood", "Exeter", "Greenway", "Huron Park", "Shipka", "Stephen Twp", "Usborne Twp"] },
  
  // Kawartha Lakes
  { name: "Kawartha Lakes", regions: ["Bethany", "Bobcaygeon", "Burnt River", "Cameron", "Coboconk", "Dunsford", "Fenelon Falls", "Janetville", "Kinmount", "Kirkfield", "Lindsay", "Little Britain", "Manilla", "Norland", "Oakwood", "Omemee", "Pontypool", "Rural Bexley", "Rural Carden", "Rural Dalton", "Rural Eldon", "Rural Emily", "Rural Fenelon", "Rural Laxton", "Rural Manvers", "Rural Mariposa", "Rural Somerville", "Rural Verulam", "Woodville"] },
  
  // Lambton
  { name: "Lambton Shores", regions: ["Arkona", "Bosanquet", "Forest", "Grand Bend", "Kettle Point", "Lambton Shores", "Port Franks", "Thedford", "Walden"] },
  { name: "Point Edward", regions: ["Point Edward"] },
  { name: "Sarnia", regions: ["Sarnia"] },
  { name: "Plympton-Wyoming", regions: ["Plympton Wyoming"] },
  { name: "Warwick", regions: ["Warwick", "Watford"] },
  { name: "St. Clair", regions: ["St. Clair"] },
  { name: "Petrolia", regions: ["Petrolia"] },
  { name: "Enniskillen", regions: ["Enniskillen", "Oil Springs", "Petrolia"] },
  { name: "Oil Springs", regions: ["Oil Springs"] },
  { name: "Brooke-Alvinston", regions: ["Brooke Alvinston", "Dawn Euphemia"] },
  
  // Leeds and Grenville
  { name: "North Grenville", regions: ["Kemptville"] },
  { name: "Gananoque", regions: ["Gananoque"] },
  { name: "Leeds and the Thousand Islands", regions: ["Front of Leeds & Seeleys Bay", "Lansdowne Village"] },
  { name: "Athens", regions: ["Athens"] },
  { name: "Front of Yonge", regions: ["Front of Yonge Twp", "Front of Escott Twp"] },
  { name: "Elizabethtown-Kitley", regions: ["Elizabethtown Kitley"] },
  { name: "Brockville", regions: ["Brockville"] },
  { name: "Augusta", regions: ["Augusta Twp"] },
  { name: "Prescott", regions: ["Prescott"] },
  { name: "Edwardsburgh/Cardinal", regions: ["Town of Cardinal", "Edwardsburgh/Cardinal Twp"] },
  
  // Lennox and Addington
  { name: "Addington Highlands", regions: ["Addington Highlands"] },
  { name: "Stone Mills", regions: ["Stone Mills"] },
  { name: "Greater Napanee", regions: ["Greater Napanee"] },
  { name: "Loyalist", regions: ["Amherstview", "Bath", "Lennox and Addington - South", "Odessa"] },
  
  // Middlesex
  { name: "Middlesex Centre", regions: ["Arva", "Ballymote", "Birr", "Bryanston", "Coldstream", "Delaware Town", "Denfield", "Ilderton", "Ivan", "Kilworth", "Komoka", "Lobo Village", "London Township", "Melrose", "Middlesex Centre", "Poplar Hill", "Rural Middlesex Centre"] },
  { name: "London", regions: ["East", "North", "South"] },
  { name: "Thames Centre", regions: ["Avon", "Crampton", "Dorchester", "Gladstone", "Harrietsville", "Mossley", "Nilestown", "Putnam", "Rural Thames Centre", "Thorndale", "Wellburn"] },
  { name: "North Middlesex", regions: ["Ailsa Craig", "Brinsley", "Carlisle", "Lieury", "Mount Carmel", "Nairn", "Parkhill", "Rural North Middlesex", "Sylvan"] },
  { name: "Lucan Biddulph", regions: ["Clandeboye", "Elginfield", "Granton", "Lucan", "Prospect Hill", "Rural Lucan Biddulph"] },
  
  // Muskoka
  { name: "Georgian Bay", regions: ["Baxter", "Freeman", "Gibson"] },
  { name: "Muskoka Lakes", regions: ["Cardwell", "Medora", "Monck", "Watt", "Wood"] },
  { name: "Huntsville", regions: ["Brunel", "Chaffey", "Stephenson", "Stisted"] },
  { name: "Lake of Bays", regions: ["Finlayson", "Franklin", "Mclean", "Ridout", "Sinclair"] },
  { name: "Bracebridge", regions: ["Draper", "Macaulay", "Monck", "Muskoka", "Oakley"] },
  { name: "Gravenhurst", regions: ["Morrison", "Muskoka", "Ryde", "Wood"] },
  
  // Niagara
  { name: "Grimsby", regions: ["Grimsby Escarpment", "Grimsby Beach", "Grimsby West", "Grimsby East"] },
  { name: "Lincoln", regions: ["Lincoln Lake", "Beamsville", "Escarpment", "Lincoln"] },
  { name: "West Lincoln", regions: [] },
  { name: "St. Catharines", regions: [] },
  { name: "Thorold", regions: [] },
  { name: "Fort Erie", regions: [] },
  { name: "Niagara Falls", regions: [] },
  { name: "Niagara-on-the-Lake", regions: [] },
  { name: "Pelham", regions: [] },
  { name: "Port Colborne", regions: [] },
  { name: "Wainfleet", regions: [] },
  { name: "Welland", regions: [] },
  
  // Norfolk
  { name: "Norwich", regions: ["Burgessville", "Curries", "Eastwood", "Hawtrey", "Holbrook", "Milldale", "Newark", "Norwich", "Norwich Town", "Otterville", "Oxford Centre", "Rural Norwich", "Springford"] },
  
  // Northumberland
  { name: "Port Hope", regions: ["Garden Hill", "Port Hope", "Rural Port Hope"] },
  { name: "Cobourg", regions: ["Cobourg"] },
  { name: "Alnwick/Haldimand", regions: ["Grafton", "Rural Alnwick/Haldimand"] },
  { name: "Alderville First Nation", regions: ["Alderville First Nation"] },
  { name: "Cramahe", regions: ["Castleton", "Colborne", "Rural Cramahe"] },
  { name: "Brighton", regions: ["Brighton", "Rural Brighton"] },
  { name: "Trent Hills", regions: ["Campbellford", "Hastings", "Rural Trent Hills", "Warkworth"] },
  
  // Oxford
  { name: "Blandford-Blenheim", regions: ["Blandford", "Blenheim", "Bright", "Drumbo", "Forest Estates", "Gobles", "Maple Lake", "Plattsville", "Princeton", "Rural Blandford-Blenheim", "Washington", "Wolverton"] },
  { name: "Ingersoll", regions: ["Ingersoll", "Ingersoll-North", "Ingersoll-South"] },
  { name: "South-West Oxford", regions: ["Beachville", "Brownsville", "Centreville", "Culloden", "Delmer", "Dereham Centre", "Dorland Subdivision", "Foldens", "Mount Elgin", "Ostrander", "Rural South-West Oxford", "Salford", "Southwest Oxford", "Sweaburg", "Verschoyle"] },
  { name: "Tillsonburg", regions: ["Tillsonburg", "Woodstock", "Woodstock-North", "Woodstock-South"] },
  { name: "Woodstock", regions: ["Woodstock-North", "Woodstock-South"] },
  { name: "Zorra", regions: ["Brooksdale", "East Nissouri", "Embro", "Harrington", "Kintore", "Lakeside", "Medina", "Rural Zorra", "Thamesford", "Uniondale", "West Zorra"] },
  { name: "East Zorra-Tavistock", regions: ["Braemar", "Cassel", "East Zorra", "Hickson", "Hidden Valley", "Huntingford", "Innerkip", "Rural East Zorra-Tavistock", "Tavistock"] },
  
  // Ottawa
  { name: "Alta Vista and Area", regions: ["Eastway Gardens/Industrial Park", "Riverview Park", "Faircrest Heights", "Applewood Acres", "Alta Vista", "Playfair Park", "Guildwood Estates-Urbandale Acres"] },
  { name: "Barrhaven", regions: ["Barrhaven-Pheasant Run", "Barrhaven-Knollsbrook", "Barrhaven-Cedargrove/Fraserdale", "Barrhaven-Heritage Park", "Barrhaven-On the Green", "Barrhaven-Longfields", "Barrhaven-Hearts Desire", "Barrhaven-Stonebridge", "Barrhaven-Strandherd", "Barrhaven East", "Barrhaven-Half Moon Bay"] },
  { name: "Beacon Hill North - South and Area", regions: ["Rothwell Heights", "Beacon Hill North", "Canotek Industrial Park", "Beaconwood", "Cardinal Heights", "Beacon Hill South"] },
  { name: "Bells Corners and South to Fallowfield", regions: ["Bellwood-Industrial Park", "Westcliffe Estates", "Bells Corners", "Lynwood Village", "Arbeatha Park", "Cedar Hill/Orchard Estates", "Fallowfield"] },
  { name: "Billings Bridge - Riverside Park and Area", regions: ["Billings Bridge", "Heron Park", "Brookfield Gardens", "Mooneys Bay/Riverside Park", "Riverside Park", "Riverside Park South"] },
  { name: "Kanata", regions: ["Kanata-Beaverbrook", "Kanata-Katimavik", "Kanata-Glencairn/Hazeldean", "Kanata-Bridlewood", "Kanata-Kanata (North West)", "Kanata-Kanata (North East)", "Kanata-Kanata Lakes/Heritage Hills", "Kanata-Morgan's Grant/South March", "Rural Kanata (Central)", "Kanata-Emerald Meadows/Trailwest"] },
  { name: "Orleans", regions: ["Convent Glen and Area", "Mer Bleue/Bradley Estates/Anderson Park"] },
  { name: "Cumberland and Area", regions: ["Chatelaine Village"] },
  { name: "Central Areas", regions: ["Centretown", "Glebe", "Old Ottawa South", "Sandy Hill", "Lowertown", "ByWard Market", "Golden Triangle"] },
  
  // Peel
  { name: "Brampton", regions: ["Airport Road/Highway 7 Business Centre", "Avondale", "Bram East", "Bram West", "Bramalea North Industrial", "Bramalea Road South Gateway", "Bramalea South Industrial", "Bramalea West Industrial", "Brampton 407 Corridor", "Brampton East", "Brampton East Industrial", "Brampton North", "Brampton South", "Brampton West", "Central Park", "Claireville Conservation", "Credit Valley", "Downtown Brampton", "Fletcher's Creek South", "Fletcher's Creek Village", "Fletcher's Meadow", "Fletcher's West", "Gore Industrial North", "Gore Industrial South", "Goreway Drive Corridor", "Heart Lake", "Heart Lake East", "Heart Lake West", "Highway 427", "Huttonville", "Madoc", "Northgate", "Northwest Brampton", "Northwest Sandalwood Parkway", "Northwood Park", "Parkway Belt Industrial Area", "Queen Street Corridor", "Sandringham-Wellington", "Sandringham-Wellington North", "Snelgrove", "Southgate", "Steeles Industrial", "Toronto Gore Rural Estate", "Vales of Castlemore", "Vales of Castlemore North", "Westgate"] },
  { name: "Mississauga", regions: ["Applewood", "Central Erin Mills", "Churchill Meadows", "City Centre", "Clarkson", "Cooksville", "Creditview", "Dixie", "East Credit", "Erin Mills", "Erindale", "Fairview", "Gateway", "Hurontario", "Lakeview", "Lisgar", "Lorne Park", "Malton", "Mavis-Erindale", "Meadowvale", "Meadowvale Business Park", "Meadowvale Village", "Mineola", "Mississauga Valleys", "Northeast", "Port Credit", "Rathwood", "Sheridan", "Sheridan Park", "Southdown", "Streetsville", "Western Business Park"] },
  { name: "Caledon", regions: ["Alton", "Bolton East", "Bolton North", "Bolton West", "Caledon East", "Caledon Village", "Cheltenham", "Inglewood", "Mono Mills", "Palgrave", "Rural Caledon"] },
  
  // Perth
  { name: "North Perth", regions: ["Listowel", "Wallace", "Gowanstown", "Monkton"] },
  { name: "Perth East", regions: ["Crystal Lake", "Ellice Twp", "Millbank", "Milverton", "Mornington Twp", "North Easthope Twp", "Shakespeare", "South Easthope Twp", "Amulree", "Gads Hill", "Newton", "Sebastopol", "Wartburg"] },
  { name: "Perth South", regions: ["Blanshard Twp", "Downie Twp", "Sebringville"] },
  { name: "St. Marys", regions: ["St. Marys"] },
  { name: "Stratford", regions: ["Stratford"] },
  { name: "West Perth", regions: ["Fullarton Twp", "Hibbert Twp", "Logan Twp", "Monkton", "Town of Mitchell", "Brunner", "Dublin", "Kirkton", "Staffa"] },
  
  // Peterborough
  { name: "Asphodel-Norwood", regions: ["Norwood", "Rural Asphodel-Norwood"] },
  { name: "Cavan Monaghan", regions: ["Millbrook", "Rural Cavan Monaghan"] },
  { name: "Curve Lake First Nation", regions: ["Curve Lake First Nation"] },
  { name: "Douro-Dummer", regions: ["Rural Douro-Dummer"] },
  { name: "Havelock-Belmont-Methuen", regions: ["Havelock", "Rural Havelock-Belmont-Methuen"] },
  { name: "Hiawatha First Nation", regions: ["Hiawatha First Nation"] },
  { name: "North Kawartha", regions: ["Rural North Kawartha"] },
  { name: "Otonabee-South Monaghan", regions: ["Rural Otonabee-South Monaghan"] },
  { name: "Peterborough", regions: ["Ashburnham", "Downtown", "Monaghan", "Northcrest", "Otonabee"] },
  { name: "Smith-Ennismore-Lakefield", regions: ["Lakefield", "Rural Smith-Ennismore-Lakefield"] },
  
  // Prescott and Russell
  { name: "Alfred and Plantagenet", regions: ["Alfred", "Plantagenet", "Rural Alfred and Plantagenet", "Wendover"] },
  { name: "Casselman", regions: ["Casselman"] },
  { name: "Champlain", regions: ["L'Orignal", "Rural Champlain", "Vankleek Hill"] },
  { name: "Clarence-Rockland", regions: ["Bourget", "Clarence Creek", "Rockland", "Rural Clarence-Rockland"] },
  { name: "East Hawkesbury", regions: ["Rural East Hawkesbury", "St-Eugene"] },
  { name: "Hawkesbury", regions: ["Hawkesbury"] },
  { name: "Russell", regions: ["Embrun", "Limoges", "Rural Russell", "Russell"] },
  { name: "The Nation", regions: ["Rural The Nation", "St-Albert", "St-Bernardin", "St-Isidore"] },
  
  // Prince Edward
  { name: "Prince Edward County", regions: ["Ameliasburgh", "Athol", "Bloomfield", "Hallowell", "Hillier", "North Marysburgh", "Picton", "Sophiasburgh", "South Marysburgh", "Wellington"] },
  
  // Simcoe
  { name: "Adjala-Tosorontio", regions: ["Everett", "Hockley Valley", "Lisle", "Loretto", "Rural Adjala-Tosorontio", "Ruskview"] },
  { name: "Barrie", regions: ["Allandale", "Ardagh", "Bayfield", "Bayshore", "Bear Creek", "Codrington", "Cundles", "Downtown", "East Bayfield", "Edgehill", "Grove East", "Holly", "Innishore", "Letitia Heights", "Little Lake", "Minet's Point", "North Shore", "Painswick North", "Painswick South", "Queen's Park", "Rural Barrie Northwest", "Rural Barrie Southeast", "Rural Barrie Southwest", "Sandy Hollow", "Sanford", "South Shore", "Sunnidale", "Wellington", "West Bayfield"] },
  { name: "Bradford West Gwillimbury", regions: ["Bond Head", "Bradford", "Rural Bradford West Gwillimbury"] },
  { name: "Christian Island 30", regions: ["Beausoleil First Nation"] },
  { name: "Clearview", regions: ["Batteaux", "Brentwood", "Creemore", "Devil's Glen", "New Lowell", "Nottawa", "Rural Clearview", "Singhampton", "Stayner"] },
  { name: "Collingwood", regions: ["Collingwood"] },
  { name: "Essa", regions: ["Angus", "Baxter", "Colwell", "Rural Essa", "Thornton"] },
  { name: "Innisfil", regions: ["Alcona", "Churchill", "Cookstown", "Gilford", "Lefroy", "Rural Innisfil", "Stroud"] },
  { name: "Midland", regions: ["Midland"] },
  { name: "New Tecumseth", regions: ["Alliston", "Beeton", "Rural New Tecumseth", "Tottenham"] },
  { name: "Orillia", regions: ["Orillia"] },
  { name: "Oro-Medonte", regions: ["Craighurst", "Edgar", "Guthrie", "Hawkestone", "Horseshoe Valley", "Moonstone", "Prices Corners", "Rural Oro-Medonte", "Shanty Bay", "Sugarbush", "Warminster"] },
  { name: "Penetanguishene", regions: ["Penetanguishene"] },
  { name: "Rama First Nation 32", regions: ["Rama First Nation"] },
  { name: "Ramara", regions: ["Atherley", "Brechin", "Rural Ramara"] },
  { name: "Severn", regions: ["Ardtrea", "Bass Lake", "Coldwater", "Fesserton", "Marchmont", "Port Severn", "Rural Severn", "Washago", "West Shore"] },
  { name: "Springwater", regions: ["Anten Mills", "Centre Vespra", "Elmvale", "Hillsdale", "Midhurst", "Minesing", "Phelpston", "Rural Springwater", "Snow Valley"] },
  { name: "Tay", regions: ["Port McNicoll", "Rural Tay", "Victoria Harbour", "Waubaushene", "Waverley"] },
  { name: "Tiny", regions: ["Lafontaine", "Perkinsfield", "Rural Tiny", "Wyebridge", "Wyevale"] },
  { name: "Wasaga Beach", regions: ["Wasaga Beach"] },
  
  // Stormont, Dundas and Glengarry
  { name: "North Dundas", regions: ["Winchester", "North Dundas (Mountain) Twp", "North Dundas (Winchester) Twp", "Chesterville"] },
  { name: "South Dundas", regions: ["Morrisburg", "South Dundas (Matilda) Twp", "South Dundas (Williamsburg) Twp", "Iroquois"] },
  { name: "North Stormont", regions: ["Finch", "North Stormont (Finch) Twp", "North Stormont (Roxborough) Twp", "Moose Creek"] },
  { name: "South Stormont", regions: ["Ingleside", "Long Sault", "South Stormont (Osnabruck) Twp", "South Stormont (Cornwall) Twp"] },
  { name: "Cornwall", regions: ["Cornwall"] },
  { name: "South Glengarry", regions: ["Lancaster", "South Glengarry (Charlottenburgh) Twp", "South Glengarry (Lancaster) Twp"] },
  { name: "Akwesasne (Part) 59", regions: ["Akwesasne (Part) 60"] },
  
  // Toronto
  { name: "Toronto", regions: ["C01: Bay Street Corridor", "C02: Annex", "C03: Corso Italia-Davenport", "C04: Bedford Park-Nortown", "C06: Bathurst Manor", "C07: Lansing-Westgate", "C08: Cabbagetown", "C09: Rosedale-Moore Park", "C10: Mount Pleasant", "C11: Flemingdon Park", "C12: Bridle Path", "C13: Banbury-Don Mills", "C14: Newtonbrook", "C15: Bayview Village", "E01: East End-Danforth", "E02: The Beaches", "E03: Danforth", "E04: Clairlea", "E05: L'Amoreaux", "E06: Birchcliffe-Cliffside", "E07: Agincourt", "E08: Scarborough Village", "E09: Bendale", "E10: Highland Creek", "E11: Malvern", "W01: High Park-Swansea", "W02: Junction Area", "W03: Caledonia-Fairbank", "W04: Weston", "W05: Black Creek", "W06: Mimico", "W07: Stonegate-Queensway", "W08: Kingsway South", "W09: Humber Heights", "W10: Rexdale"] },
  
  // Waterloo
  { name: "Cambridge", regions: ["Blair", "Central Preston", "Fiddlesticks", "Galt City Centre", "Greenway-Chaplin", "Hespeler", "Industrial", "Lang's Farm", "North Cambridge", "North Galt", "Preston Heights", "South East Galt", "South West Galt"] },
  { name: "Kitchener", regions: ["Alpine", "Bridgeport East", "Bridgeport North", "Bridgeport West", "Cedar Hill", "Central Frederick", "Centreville Chicopee", "Cherry Hill", "Country Hills", "Country Hills West", "Doon South", "Downtown", "East Ward", "Forest Heights", "Forest Hill", "Grand River North", "Grand River South", "Idlewood", "KW Hospital", "Laurentian Hills", "Laurentian West", "Lower Doon", "Pioneer Park", "Pioneer Tower East", "Pioneer Tower West", "Rosemount", "South Ward", "Stanley Park", "Vanier", "Victoria Hills", "Victoria North", "Victoria Park", "Victoria South", "Westmount"] },
  { name: "North Dumfries", regions: ["Ayr", "Rural North Dumfries"] },
  { name: "Waterloo", regions: ["Beechwood", "Central Waterloo", "Columbia Forest", "Conservation Meadows", "Eastbridge", "Erbsville", "Lakeshore", "Laurelwood", "Lincoln", "Lincoln Heights", "Mary-Allen", "Mount Hope Huron Park", "Northdale", "Rural East", "Rural West", "Uptown Waterloo", "Westvale", "Willowdale"] },
  { name: "Wellesley", regions: ["Hawkesville", "Linwood", "Rural Wellesley", "St. Clements", "Wellesley"] },
  { name: "Wilmot", regions: ["Baden", "New Dundee", "New Hamburg", "Rural Wilmot"] },
  { name: "Woolwich", regions: ["Breslau", "Conestogo", "Elmira", "Floradale", "Heidelberg", "Maryhill", "Rural Woolwich", "St. Jacobs", "West Montrose"] },
  
  // Wellington
  { name: "Centre Wellington", regions: ["Belwood", "Elora/Salem", "Fergus", "Rural Centre Wellington", "Rural Centre Wellington East", "Rural Centre Wellington West"] },
  { name: "Erin", regions: ["Erin", "Hillsburgh", "Rural Erin"] },
  { name: "Guelph", regions: ["Brant", "Central East", "Central West", "Clairfields", "College", "Dovercliffe Park/Old University", "Downtown", "Exhibition Park", "General Hospital", "Grange Hill East", "Grange Road", "Guelph South", "Hanlon Creek", "Hanlon Industrial", "June Avenue", "Kortright East", "Kortright Hills", "Kortright West", "Minto", "Northwest Industrial Park", "Old University", "Onward Willow", "Parkwood Gardens", "Pine Ridge", "Pineridge/Westminster Woods", "Riverside Park", "Rural Guelph/Eramosa East", "Rural Guelph/Eramosa West", "Rural Puslinch West", "St. George's", "St. Patrick's Ward", "Two Rivers", "Victoria North", "Village", "Village By The Arboretum", "Watson", "Waverley", "West Willow Woods", "Willow West/Sugarbush/West Acres", "York/Watson Industrial Park"] },
  { name: "Guelph/Eramosa", regions: [] },
  { name: "Mapleton", regions: ["Alma", "Drayton", "Moorefield", "Rural Mapleton"] },
  { name: "Minto", regions: ["Clifford", "Harriston", "Palmerston", "Rural Minto"] },
  { name: "Puslinch", regions: ["Aberfoyle", "Morriston", "Rural Puslinch"] },
  { name: "Wellington North", regions: ["Arthur", "Mount Forest", "Rural Wellington North"] },
  
  // York
  { name: "Aurora", regions: ["Aurora Estates", "Aurora Grove", "Aurora Heights", "Aurora Highlands", "Aurora Village", "Bayview Northeast", "Bayview Southeast", "Bayview Wellington", "Hills of St Andrew", "Rural Aurora"] },
  { name: "East Gwillimbury", regions: ["Holland Landing", "Mt Albert", "Queensville", "Rural East Gwillimbury", "Sharon"] },
  { name: "Georgina", regions: ["Baldwin", "Belhaven", "Historic Lakeshore", "Keswick North", "Keswick South", "Pefferlaw", "Sutton & Jackson's Point", "Virginia"] },
  { name: "Georgina Islands", regions: ["Fox Island", "Georgina Island", "Snake Island"] },
  { name: "King", regions: ["King City", "Nobleton", "Pottageville", "Rural King", "Schomberg"] },
  { name: "Markham", regions: ["Angus Glen", "Berczy", "Box Grove", "Buttonville", "Cache", "Cachet", "Cathedral", "Cedar Grove", "Cornell", "Dickson Hill", "Downtown Markham", "German Mills", "Greensborough", "Langstaff", "Legacy", "Markham Village", "Milliken", "Parkway", "Raymerville", "Rouge Fairways", "Royal Orchard", "Sherwood", "South Unionville", "Thornhill", "Unionville", "Victoria Square", "Vinegar Hill", "Wismer", "Woodbine North"] },
  { name: "Newmarket", regions: ["Armitage", "Bristol-London", "Central Newmarket", "Glenway Estates", "Gorham-College Manor", "Huron Heights-Leslie Valley", "Newmarket Industrial Park", "Stonehaven-Wyndham", "Summerhill Estates", "Woodland Hill"] },
  { name: "Richmond Hill", regions: ["Bayview Hill", "Crosby", "Devonsleigh", "Doncrest", "Downtown", "Elgin Mills", "Headford", "Jefferson", "Lake Wilcox", "Langstaff", "Mill Pond", "North Richvale", "Oak Ridges", "Observatory", "Richmond Heights", "Rouge Woods", "Rural Richmond Hill", "South Richvale", "Westbrook", "Yonge North"] },
  { name: "Vaughan", regions: ["Beverley Glen", "Brownridge", "Carrville", "Concord", "Corporate Centre", "Dufferin Hill", "East Woodbridge", "Elder Mills", "Glen Shields", "Hillcrest Village", "Humewood", "Kleinburg", "Lakeview Estates", "Langstaff", "Maple", "Millwood", "Nashville", "Pine Valley Business Park", "Pinewood", "Rural Vaughan", "Sonoma Heights", "Springfarm", "Steeles", "Thornhill", "Thornhill Woods", "Uplands", "Valley", "Vellore", "West Woodbridge", "Woodbridge"] },
  { name: "Whitchurch-Stouffville", regions: ["Ballantrae", "Rural Whitchurch-Stouffville", "Stouffville"] },
];

// Get all city names as a simple array
export const CITY_NAMES = CITIES.map(city => city.name);

// Search function to filter cities
export function searchCities(query: string): CityOption[] {
  if (!query || query.length < 1) return [];
  
  const lowerQuery = query.toLowerCase();
  return CITIES.filter(city => 
    city.name.toLowerCase().includes(lowerQuery)
  ).slice(0, 10); // Limit to 10 results
}

// Get regions for a specific city
export function getCityRegions(cityName: string): string[] {
  const city = CITIES.find(c => c.name.toLowerCase() === cityName.toLowerCase());
  return city?.regions || [];
}
