Prompt for Cline: PureProperty.ca System & Strategy Master ContextContext & MissionYou are the lead AI coding agent building "PureProperty.ca," the definitive "Bloomberg Terminal for Canadian Real Estate." Our goal is to outcompete mass-market platforms like Housesigma and Realtor.ca by providing institutional-grade "shadow data" to high-intent, analytical retail investors, developers, and boutique wholesalers. Real estate is strictly a mathematical instrument here. We must cross-reference user stories and feature priorities from "Persona mapping to features.xlsx" for all subsequent feature development.1. Architectural Guidelines ("The Shadow MLS")The Ingestion Layer: Do not write frontend code that queries the Ampre/TRREB API directly. Data is pulled asynchronously via a Node.js ETL Worker using background cron jobs to bypass board rate limits.  The Storage Vault: The ETL dumps raw JSONB into Supabase (Postgres), which acts as our immutable backup and source of truth.  The Search Layer: Typesense is our in-memory, typo-tolerant search engine.  Frontend Constraints: The Next.js frontend must be completely blind to Ampre and Supabase. The UI talks exclusively to Typesense to guarantee sub-50ms latency. Ensure users experience zero loading spinners; the map and list must update the instant they touch a filter.  2. State Management & Data Logic RequirementsData Normalization (IDX vs VOW): You must handle messy, overlapping fields from our JSON payloads. For example, tax data may appear as TaxAnnualAmount (e.g., 4493) or AnnualTaxes (e.g., 8456.34). You must normalize these before feeding the calculator state.  Proprietary Metric Generation:Capital Burn Rate: Implement a dynamic calculator state using the formula: (ListPrice * Mortgage Rate) + (TaxAnnualAmount / 12) + Maintenance. Account for null maintenance variables, falling back to AssociationFee (e.g., 123) if available.  Suite / Value-Add Potential: Create a deterministic flag for duplex conversion. Parse the Basement array for strings like "Unfinished" or "Finished". Combine this with RoomsBelowGrade integers (e.g., 2 or 4) or iterate through the nested rooms array searching for RoomLevel: "Basement".  True DOM: Calculate true days on market deterministically by grouping listings by a unique Property ID to break the agent relisting cycle.Global State: Use Zustand or React Context to tightly couple the terminal UI controls (sliders, toggles) directly to the Typesense search parameters, triggering instant sub-50ms re-renders.  3. UI/UX & CSS ConstraintsZero Time-To-Value (TTV): The primary view must be a 100vh "Command Center." Do not use scrolling hero images or hide tools behind "More Filters" menus.Color Palette: Strictly adhere to a SaaS Dark Mode theme utilizing Tailwind CSS slate-950 as the primary background.Asymmetric Terminal View: When a property is selected, implement a w-7/10 and w-3/10 split layout (70/30).Left Pane (70%): Display structural data and an image "bento grid" parsing the images or media arrays (e.g., URLs from [https://trreb-image.ampre.ca/](https://trreb-image.ampre.ca/)...).  Right Pane (30%): A sticky, interactive financial calculator (Cap Rate, Carry Cost) that updates instantly on user input.Geospatial Rendering: Do not use traditional Google Maps clustered pins. Use Deck.gl and Mapbox (WebGL 3D) to render 3D hexagon heatmaps mapped against municipal zoning boundaries and Yield/DOM metrics.Execution Rules:When implementing any specific component or route, you must adhere strictly to these data structures and CSS guidelines. Never write traditional consumer real estate UI; always build for an institutional terminal aesthetic

The main pages of the website are -
GLOBAL UI/UX CONSTRAINTSAesthetic: Institutional SaaS "Terminal" / Anti-Consumer.Color Palette: Strict dark mode (bg-slate-950, pure white slate-50 primary text, muted slate-400 secondary text, cyan/emerald for data highlights).Typography: Monospace fonts for data fields and metrics; clean geometric sans-serif for UI elements.Interactivity: Zero TTV (Time-To-Value). No loading spinners. All core filtering must be handled via Typesense for sub-50ms latency. No fluff, no "lifestyle" imagery.

1. The Public Conversion Gate (Homepage)Route: /Audience: Unauthenticated public traffic.Purpose: Act as a brutalist filter. Intimidate casual homebuyers and capture high-intent "Smart Money" operators.UI/Layout: Single screen (100vh), no scrolling.Background: Low-opacity (10%) Deck.gl or static abstract hex-bin map wireframe.Center: Aggressive typography ("REAL ESTATE IS A MATHEMATICAL INSTRUMENT").CTA: A hard, unrounded rectangle button: [ APPLY FOR TERMINAL ACCESS ].Footer: A live "System Pulse" ticker running on a monospace font displaying Supabase ingestion stats and Typesense latency

2. Programmatic SEO Landing PagesRoute: /markets/[city]/[asset-type] (e.g., /markets/london/high-yield-townhouses)Audience: Top-of-funnel Google search traffic.Purpose: Capture hyper-specific, long-tail investor searches.UI/Layout: Displays aggregated macro-level stats (e.g., average ListPrice , average Cap Rate, distress volume based on DaysOnMarket ). It teases the underlying data but heavily blurs or gates specific listings to drive users to the /apply route.  

3. The Velvet Rope (Onboarding & Authentication)Route: /apply and /loginAudience: High-intent leads converting to users.Purpose: Satisfy real estate board VOW compliance (mandatory account creation to see sold data/specifics) while establishing psychological exclusivity.UI/Layout (/apply): A strict 3-step Next.js form.Step 1: Identity. Legal entity name, RECO license (if applicable).Step 2: Intent. Selection of the primary persona 1. Smart Homebuyer (The new persona)Focus: True Carry Cost, CapEx/Condition, Mortgage Helper potential, good schools/transit.
2. Cashflow Investor -Focus: Rent vs. Carry Cost, Cap Rates, Multi-family.
3. Flippers & Deal Hunters -Focus: True DOM, Distress Flags, Price Drops, Fixer-Uppers.
4. Builders & Developers -Focus: Zoning, Lot Frontage, Density Potential. This sets their default Zustand global state workspace.Step 
3: Checkout & VOW Terms. $19/mo SaaS paywall and legal compliance checkboxes
.4. The Command Center (The Returning User Homepage)Route: /terminalAudience: Authenticated, subscribed users.Purpose: The core product. A sub-50ms search and visualization engine completely bypassing traditional MLS rate limits.UI/Layout: Edge-to-edge 100vh workspace.Top Nav: Contains the Workspace Switcher (Zustand state dropdown) to instantly swap between personas , which dynamically updates the columns and map layers.Top Bar: Instant Typesense sliders (Target Gross Yield, True DOM, Max Price).Left Pane (60%): Deck.gl 3D interactive map rendering hex-bin heatmaps or PostGIS zoning overlays.Right Pane (40%): A virtualized data table (React Virtuoso) of active listings, prioritizing derived financial metrics over standard bedrooms/bathrooms.
5. The Site Analysis Terminal (Property Detail Page)Route: /terminal/analysis/[ListingKey]Audience: Authenticated users evaluating a specific asset (e.g., Listing X12639568 or W12632618 ).  Purpose: Provide instant ROI math and structural reality without fluffy agent descriptions.UI/Layout: A sticky 70/30 asymmetrical split.Left Column (70%): The "Bento Grid". Shows raw parsed data critical to developers/investors: exact Lot dimensions (LotWidth, LotDepth ), RoomsBelowGrade , and Basement arrays (e.g., Unfinished , Finished ). Displays PostGIS zoning overlays natively on a mini-map.  Right Column (30% Sticky): The Institutional Pro Forma Calculator. Users can tweak Mortgage Rate and Downpayment sliders to instantly see the updated Capital Burn Rate and Cap Rate.Action CTA: A massive button to [ ROUTE TO ADVISOR ].
6. Identity & Intent Configuration (Settings)Route: /profileAudience: Authenticated users.Purpose: Deep configuration of the user's data feed and terminal behavior.UI/Layout: Dense, industrial configuration panels. Users can set their default map rendering (e.g., 3D Zoning Alpha vs. Yield Heatmap), assign derived metric priorities, and toggle global "Alpha Flags" (e.g., auto-flagging any listing with RoomsBelowGrade > 1 for suite potential).7. System Alerts (The Arbitrage Engine)Route: /alertsAudience: Authenticated users.Purpose: Allow users to set up automated background watchers (FOMO generation).UI/Layout: A logic-builder interface. Users create "If This, Then That" rules based on the ETL worker's shadow data. Example: IF True DOM > 90 AND Area = N6L 0E8, THEN send HTML text email.  


VOW API Payload-
Resource	Standard Name	Display Name	Type	Key
property	AccessToProperty	Access To Property	String List, Multi	
property	AccessibilityFeatures	Accessibility Features	String List, Multi	
property	AddChangeTimestamp	AddChangeTimestamp 1	Timestamp	
property	AdditionalMonthlyFee	POTL Monthly Fee	Number	
property	AdditionalMonthlyFeeFrequency	Additional Monthly Fee Frequency	String List, Single	
property	AlternativePower	Alternative Power	String List, Multi	
property	Amps	Amps	Number	
property	ApartmentNumber	Apartment Number	String	
property	ApproximateAge	Approximate Age	String List, Single	
property	ArchitecturalStyle	Style	String List, Multi	
property	AssessmentYear	Assessment Year	Number	
property	AssignmentYN	Assignment	Boolean	
property	AssociationAmenities	Building Amenities	String List, Multi	
property	AssociationFee	Maintenance	Number	
property	AssociationFeeIncludes	Included in Maintenance Costs	String List, Multi	
property	AssociationName	Condo Registry Office	String	
property	AssociationYN	Association Yes/No	Boolean	
property	AttachedGarageYN	Attached Garage Yes/No	Boolean	
property	BackOnMarketEntryTimestamp	BackOnMarket Timestamp	Timestamp	
property	BalconyType	Balcony	String List, Single	
property	Basement	Basement	String List, Multi	
property	BasementYN	Basement	Boolean	
property	BathroomsTotalInteger	Washrooms	Number	
property	BaySizeLengthFeet	Length Feet	Number	
property	BaySizeLengthInches	Length Inches	Number	
property	BaySizeWidthFeet	Width Feet	Number	
property	BaySizeWidthInches	Width Inches	Number	
property	BedroomsAboveGrade	# of Bedrooms	Number	
property	BedroomsBelowGrade	Bedrooms +	Number	
property	BedroomsTotal	Bedrooms Total	Number	
property	BoardPropertyType	Board Property Type	String List, Single	
property	BrokerFaxNumber	Broker Fax Number	String	
property	BuildingAreaTotal	Total Area	Number	
property	BuildingAreaUnits	Total Area Code	String List, Single	
property	BuildingName	Building Name	String	
property	BusinessName	Business/ Building Name	String	
property	BusinessType	Use	String List, Multi	
property	BuyOptionYN	Buy Option	Boolean	
property	BuyerOfficeName	Buyer Office Name	String	
property	CableYNA	Cable	String List, Single	
property	CarportSpaces	Carport Spaces	Number	
property	CentralVacuumYN	Central Vacuum	Boolean	
property	ChannelName	Channel Name	String	
property	ChattelsYN	Chattels	Boolean	
property	City	Municipality	String List, Single	
property	CityRegion	Community	String	
media	ClassName	Class Name	String List, Single	
property	ClearHeightFeet	Clear Height Feet	Number	
property	ClearHeightInches	Clear Height Inches	Number	
property	CloseDate	Close Date	Date	
property	CloseDateHold	Close Date	Date	
property	ClosePrice	Close Price	Number	
property	ClosePriceHold	Close Price	Number	
property	CoBuyerOfficeName	Co-Buyer Office Name	String	
Property	CoBuyerOfficeName3	Co-Operating Salesperson 3 Brokerage	String	
Property	CoBuyerOfficeName4	Co-Operating Salesperson 4 Brokerage	String	
property	CoListAgentAOR	Co-List Agent AOR	String List, Single	
property	CoListOfficeName	Co-List Office Name	String	
Property	CoListOfficeName3	Broker 3/Salesperson 3 Brokerage	String	
Property	CoListOfficeName4	Broker 4/Salesperson 4 Brokerage	String	
property	CoListOfficePhone	Co-List Office Phone	String	
property	CommercialCondoFee	Condo Maintenance Fees Monthly	Number	
property	CommercialCondoFeeFrequency	CommercialCondoFeeFrequency	String List, Single	
property	CommonAreaUpcharge	Common Area Upcharge	Number	
property	CommunityFeatures	Area Influences	String List, Multi	
property	ConditionOfSale	Condition Of Sale	String	
property	ConditionalExpiryDate	ConditionalExpiryDate	Date	
property	CondoCorpNumber	Condo Corp Number	Number	
property	ConstructionMaterials	Exterior	String List, Multi	
property	ContactAfterExpiryYN	Contact After Expired	Boolean	
property	ContractStatus	ContractStatus	String List, Single	
property	Cooling	Air Conditioning	String List, Multi	
property	CoolingYN	Cooling Yes/No	Boolean	
property	Country	Country	String List, Single	
property	CountyOrParish	Area	String List, Single	
property	CoveredSpaces	Garage Parking Spaces	Number	
property	CraneYN	Crane	Boolean	
property	CreditCheckYN	Credit Check	Boolean	
property	CrossStreet	Direction/ Main Cross Streets	String	
property	DDFYN	Distribute to DDF/IDX	Boolean	
property	DaysOnMarket	Days On Market	Number	
property	DealFellThroughEntryTimestamp	Deal Fall Through Timestamp	Timestamp	
property	DenFamilyroomYN	Family Room	Boolean	
property	DepositRequired	Deposit Required	Boolean	
property	DevelopmentChargesPaid	Development Charges Paid	String List, Multi	
property	DirectionFaces	Fronting On	String List, Single	
property	Directions	Directions	String	
property	DiscloseAfterClosingDate	DiscloseAfterClosingDate	String	
property	Disclosures	Easements/ Restrictions	String List, Multi	
property	DoNotDiscloseUntilClosingYN	DoNotDiscloseUntilClosingYN	Boolean	
property	DockingType	DockingType	String List, Multi	
property	DoubleManShippingDoors	Double Man Shipping Doors #	Number	
property	DoubleManShippingDoorsHeightFeet	Doors Height Feet	Number	
property	DoubleManShippingDoorsHeightInches	Doors Height Inches	Number	
property	DoubleManShippingDoorsWidthFeet	Doors Width Feet	Number	
property	DoubleManShippingDoorsWidthInches	Doors Width Inches	Number	
property	DriveInLevelShippingDoors	Drive-In Level Shipping Doors #	Number	
property	DriveInLevelShippingDoorsHeightFeet	Doors Height Feet	Number	
property	DriveInLevelShippingDoorsHeightInches	Doors Height Inches	Number	
property	DriveInLevelShippingDoorsWidthFeet	Doors Width Feet	Number	
property	DriveInLevelShippingDoorsWidthInches	Doors Width Inches	Number	
property	ElectricExpense	Hydro Expense	Number	
property	ElectricOnPropertyYN	Electric On Property Yes/No	Boolean	
property	ElectricYNA	Hydro	String List, Single	
property	ElevatorType	Elevator	String List, Single	
property	ElevatorYN	Elevator/ Lift	Boolean	
property	EmploymentLetterYN	Employment Letter	Boolean	
property	EnergyCertificate	EnergyCertificate	Boolean	
property	EnsuiteLaundryYN	Ensuite Laundry	Boolean	
property	EscapeClauseHours	Escape Clause Hours	String	
property	EscapeClauseYN	Escape Clause YN	Boolean	
property	EstimatedInventoryValueAtCost	Estimated Inventory Value At Cost	Number	
property	Exclusions	Exclusions	String	
property	ExerciseRoomGym	Exercise Room Gym	String List, Single	
property	Expenses	Expenses Actual/Estimated	String List, Single	
property	ExpirationDate	Expiry Date	Date	
property	Exposure	Exposure	String List, Single	
property	ExtensionEntryTimestamp	Extention Timestamp	Timestamp	
property	ExteriorFeatures	Exterior Features	String List, Multi	
property	FarmFeatures	FarmFeatures	String List, Multi	
property	FarmType	Farm/ Agriculture	String List, Multi	
property	FinancialStatementAvailableYN	Financial Statement	Boolean	
property	FireplaceFeatures	Fireplace Features	String List, Multi	
property	FireplaceYN	Fireplace/ Stove	Boolean	
property	FireplacesTotal	Fireplaces Total	Number	
property	FoundationDetails	Foundation Details	String List, Multi	
property	FractionalOwnershipYN	Fractional Ownership	Boolean	
property	FranchiseYN	Franchise	Boolean	
property	FreestandingYN	Freestanding	Boolean	
property	FrontageLength	Lot Front	String	
property	Furnished	Furnished	String List, Single	
property	GarageParkingSpaces	Garage Parking Spaces	String	
property	GarageType	Garage Type	String List, Single	
property	GarageYN	Garage Yes/No	Boolean	
property	GasYNA	Gas (Natural)	String List, Single	
property	GradeLevelShippingDoors	Grade Level Shipping Doors #	Number	
property	GradeLevelShippingDoorsHeightFeet	Doors Height Feet	Number	
property	GradeLevelShippingDoorsHeightInches	Doors Height Inches	Number	
property	GradeLevelShippingDoorsWidthFeet	Doors Width Feet	Number	
property	GradeLevelShippingDoorsWidthInches	Doors Width Inches	Number	
property	GreenCertificationLevel	Certification Level	String	
property	GreenPropertyInformationStatement	Green Property Information Statement	Boolean	
property	GrossRevenue	Gross Income/Sales	Number	
property	HSTApplication	HST Applicable to Sale Price	String List, Multi	
property	HandicappedEquippedYN	Physically Handicapped-Equipped	Boolean	
property	HeatSource	Heat Source	String List, Single	
Property	HeatSourceMulti	Heat Source	String List, Multi	
property	HeatType	Heat Type	String List, Single	
Property	HeatTypeMulti	Heat Type	String List, Multi	
property	HeatingExpenses	Heat Expense	Number	
property	HeatingYN	Heating Yes/No	Boolean	
property	HoldoverDays	Holdover Days	Number	
property	HoursDaysOfOperation	Days Open	String List, Multi	
property	HoursDaysOfOperationDescription	Hours Open	String	
media	ImageHeight	Image Height	Number	
media	ImageOf	Image Of	String List, Single	
media	ImageSizeDescription	Image Size	String List, Single	
media	ImageWidth	Image Width	Number	
property	ImportTimestamp	Import Timestamp	Timestamp	
property	Inclusions	Inclusions	String	
property	IndustrialArea	Industrial Area	Number	
property	IndustrialAreaCode	Industrial Area Code	String List, Single	
property	InsuranceExpense	Insurance Expense	Number	
property	InteriorFeatures	Interior Features	String List, Multi	
property	InternetAddressDisplayYN	Display Address on Internet	Boolean	
property	InternetEntireListingDisplayYN	Distribute to Internet	Boolean	
property	IslandYN	Island	Boolean	
property	KitchensAboveGrade	# of Kitchens	Number	
property	KitchensBelowGrade	Kitchens +	Number	
property	KitchensTotal	# of Kitchens	Number	
property	LaundryFeatures	Laundry Access	String List, Multi	
property	LaundryLevel	Laundry Level	String List, Single	
property	LeaseAgreementYN	Lease Agreement	Boolean	
property	LeaseAmount	Lease Amount	Number	
property	LeaseTerm	Lease Term	String List, Single	
property	LeaseToOwnEquipment	Lease To Own Equipment	String List, Multi	
property	LeasedConditionalEntryTimestamp	Leased Condition Timestamp	Timestamp	
property	LeasedEntryTimestamp	Leased Timestamp	Timestamp	
property	LeasedLandFee	Leased Land Fee	Number	
property	LeasedTerms	Leased Terms	String	
property	LegalApartmentNumber	Apartment/Unit #	String	
property	LegalStories	Level	String	
property	LinkProperty	Link Property	String	
property	LinkYN	LINK	Boolean	
property	LiquorLicenseYN	L.L.B.O.	Boolean	
property	ListAOR	List AOR	String List, Single	
property	ListOfficeName	List Office Name	String	
property	ListPrice	List Price	Number	
property	ListPriceUnit	List Price Code	String List, Single	
property	ListingContractDate	Contract Commencement	Date	
propertyrooms	ListingID	Listing ID	String	
property	ListingId	Listing ID	String	
openhouse	ListingKey	Listing Key	String	
property	ListingKey	Listing Key	String	
propertyrooms	ListingKey	Listing Key	String	
property	LivingAreaRange	Approximate Square Footage	String List, Single	
property	LocalImprovements	Local Improvements	Boolean	
property	LocalImprovementsComments	Local Improvements Comments	String	
property	Locker	Locker	String List, Single	
property	LockerLevel	Locker Level	String	
property	LockerNumber	Locker Number	String	
property	LockerUnit	Locker Unit	String	
media	LongDescription	Long Description	String	
property	LotDepth	Lot Depth	Number	
property	LotDimensionsSource	Lot Dimensions Source	String List, Single	
property	LotFeatures	Lot Features	String List, Multi	
property	LotIrregularities	Lot Irregularities	String	
property	LotShape	Lot Shape	String List, Single	
property	LotSizeArea	Lot Size Area	Number	
property	LotSizeAreaUnits	Lot Size Area Code	String	
property	LotSizeDimensions	Lot Size Dimensions	String	
property	LotSizeRangeAcres	Acreage	String List, Single	
property	LotSizeSource	Lot Size Source	String List, Single	
property	LotSizeUnits	Lot Size Code	String List, Single	
property	LotType	Lot/ Building/ Unit Code	String List, Single	
property	LotWidth	Lot Width/Frontage	Number	
property	MLSAreaDistrictOldZone	MLS Area District Old Zone	String	
property	MLSAreaDistrictToronto	MLS Area District Toronto	String	
property	MLSAreaMunicipalityDistrict	MLS Area Municipality District	String	
property	MainLevelBathrooms	Main Level Bathrooms	Number	
property	MainLevelBedrooms	Main Level Bedrooms	Number	
property	MainOfficeKey	Main Office Key	String	
property	MaintenanceExpense	Maintenance Expense	Number	
property	MajorChangeTimestamp	Major Change Timestamp	Timestamp	
property	MapColumn	Map Column (Numeric)	Number	
property	MapPage	Map #	String	
property	MapRow	Map Row (Alpha)	String	
property	MaximumRentalMonthsTerm	Maximum Rental Term Months	Number	
media	MediaCategory	Media Category	String List, Single	
property	MediaChangeTimestamp	Media Change Timestamp	Timestamp	
media	MediaHTML	Media HTML	String	
media	MediaKey	Media Key	String	
property	MediaListingKey	Media Listing Key	String	
media	MediaModificationTimestamp	Media Modification Timestamp	Timestamp	
media	MediaObjectID	Media Object ID	String	
media	MediaStatus	Media Status	String List, Single	
media	MediaType	Media Type	String List, Single	
media	MediaURL	Media URL	String	
property	MinimumRentalTermMonths	Minimum Rental Term Months	Number	
property	MlsStatus	MLS Status	String List, Single	
media	ModificationTimestamp	Modification Timestamp	Timestamp	
openhouse	ModificationTimestamp	Modification Timestamp	Timestamp	
property	ModificationTimestamp	Modification Timestamp	Timestamp	
propertyrooms	ModificationTimestamp	Modification Timestamp	Timestamp	
property	MortgageComment	Mortgage Comments	String	
property	NetOperatingIncome	Net Income Before Debt	Number	
property	NewConstructionYN	New Construction Yes/No	Boolean	
property	NumberOfFullTimeEmployees	Employees	Number	
property	NumberOfKitchens	Number Of Kitchens	String	
property	NumberSharesPercent	# Shares %	String	
property	OccupantType	Occupancy	String List, Single	
property	OfficeApartmentArea	Office Apartment Area	Number	
property	OfficeApartmentAreaUnit	Office Apartment Area Code	String List, Single	
office	OfficeKey	Office Key	String	
office	OfficeName	Office Name	String	
property	OldPhotoInstructions	Old Photo Instructions	String	
openhouse	OpenHouseDate	Open House Date	Date	
openhouse	OpenHouseEndTime	Open House End Time	Timestamp	
OpenHouse	OpenHouseFormat	Open House Format	String List, Single	
openhouse	OpenHouseId	Open House ID	String	
openhouse	OpenHouseKey	Open House Key	String	
openhouse	OpenHouseStartTime	Open House Start Time	Timestamp	
openhouse	OpenHouseStatus	Open House Status	String List, Single	
openhouse	OpenHouseType	Open House Type	String List, Single	
OpenHouse	OpenHouseURL	Open House URL	String	
property	OperatingExpense	Operating Expense	Number	
media	Order	Order	Number	
PropertyRooms	Order	Order	Number	
openhouse	OriginalEntryTimestamp	Original Entry Timestamp	Timestamp	
property	OriginalEntryTimestamp	Original Entry Timestamp	Timestamp	
property	OriginalListPrice	Original List Price	Number	
property	OriginalListPriceUnit	Original List Price Unit	String List, Single	
property	OriginatingSystemID	Originating System ID	String	
property	OriginatingSystemKey	Originating System Key	String	
property	OriginatingSystemName	Originating System Name	String	
property	OtherExpense	Other Expense	Number	
property	OtherStructures	Other Structures	String List, Multi	
property	OutOfAreaMunicipality	Out Of Area Municipality	String	
property	OutsideStorageYN	Outside Storage	Boolean	
property	ParcelNumber	PIN#	String	
Property	ParcelNumber2	Additional PIN #	Number	
property	ParcelOfTiedLand	Parcel of Tied Land	String List, Single	
property	ParkingFeatures	Parking Features	String List, Multi	
property	ParkingLevelUnit1	Parking Level/Unit 1	String	
property	ParkingLevelUnit2	Parking Level/Unit 2	String	
property	ParkingMonthlyCost	Parking Cost/ Month	Number	
property	ParkingSpaces	Parking Spaces	Number	
property	ParkingSpot1	Parking Spot 1	String	
property	ParkingSpot2	Parking Spot 2	String	
property	ParkingTotal	Total Parking Spaces	Number	
property	ParkingType1	Parking Type 1	String List, Single	
property	ParkingType2	Parking Type 2	String List, Single	
property	PaymentFrequency	Payment Frequency	String List, Single	
property	PaymentMethod	Payment Method	String List, Single	
property	PercentBuilding	% Building	String	
property	PercentListPrice	PercentListPrice	String	
property	PercentRent	Percentage Rent	Number	
media	Permission	Permission	String List, Multi	
property	PermissionToContactListingBrokerToAdvertise	Permission To Contact Listing Broker To Advertise	Boolean	
property	PetsAllowed	Pets Permitted	String List, Multi	
property	PhotosChangeTimestamp	Photos Change Timestamp	Timestamp	
property	PictureYN	PictureYN	Boolean	
property	PoolFeatures	Pool	String List, Multi	
property	PortionLeaseComments	Portion of Property Comments	String	
property	PortionPropertyLease	Portion of Property for Lease	String List, Multi	
property	PossessionDate	Possession Date	Date	
property	PossessionDetails	Possession Remarks	String	
property	PossessionType	Possession Type	String List, Single	
property	PostalCode	Postal Code	String	
media	PreferredPhotoYN	Preferred Photo YN	Boolean	
property	PreviousListPrice	Previous List Price	Number	
property	PriceChangeTimestamp	Price Change Timestamp	Timestamp	
property	PriorMlsStatus	Prior MLS Status	String List, Single	
property	PriorPriceCode	PriorPriceCode	String List, Single	
property	PrivateEntranceYN	Private Entrance	Boolean	
property	PrivateRemarks	Remarks for Brokerages	String	
property	ProfessionalManagementExpense	Management Expense	Number	
property	PropertyAttachedYN	Property Attached Yes/No	Boolean	
property	PropertyFeatures	Property Features/ Area Influences	String List, Multi	
property	PropertyManagementCompany	Property Management Company	String	
property	PropertySubType	Type	String List, Single	
property	PropertyType	Property Type	String List, Single	
property	PropertyUse	Category	String List, Single	
property	PublicRemarks	Remarks For Clients	String	
property	PublicRemarksExtras	Extras	String	
property	PurchaseContractDate	Sold Date	Date	
property	Rail	Rail	String List, Single	
property	RecreationRoomYN	Recreation Room YN	Boolean	
property	ReferencesRequiredYN	References Required	Boolean	
property	RentIncludes	Included in Lease Cost	String List, Multi	
property	RentalApplicationYN	Rental Application Required	Boolean	
property	RentalItems	Rental Items	String	
media	ResourceName	Resource Name	String List, Single	
media	ResourceRecordKey	Resource Record Key	String	
property	RetailArea	Retail Area	Number	
property	RetailAreaCode	Retail Area Code	String List, Single	
property	RoadAccessFee	Road Access Fee	Number	
property	RollNumber	Assessment Roll Number (ARN)	String	
property	Roof	Roof	String List, Multi	
propertyrooms	RoomArea	Room Area	Number	
propertyrooms	RoomAreaSource	Room Area Source	String List, Single	
propertyrooms	RoomAreaUnits	Room Area Units	String List, Single	
propertyrooms	RoomDescription	Room Description	String	
propertyrooms	RoomDimensions	Room Dimensions	String	
propertyrooms	RoomFeature1	Room Feature 1	String List, Single	
propertyrooms	RoomFeature2	Room Feature 2	String List, Single	
propertyrooms	RoomFeature3	Room Feature 3	String List, Single	
propertyrooms	RoomFeatures	Room Features	String List, Multi	
propertyrooms	RoomKey	Room Key	String	
propertyrooms	RoomLength	Room Length	Number	
propertyrooms	RoomLengthWidthSource	Room Length/Width Source	String List, Single	
propertyrooms	RoomLengthWidthUnits	Room Length/Width Units	String List, Single	
propertyrooms	RoomLevel	Room Level	String List, Single	
PropertyRooms	RoomStatus	Room Status	String List, Single	
property	RoomType	Room Type	String List, Multi	
propertyrooms	RoomType	Room Type	String List, Single	
propertyrooms	RoomWidth	Room Width	Number	
property	RoomsAboveGrade	# of Rooms	Number	
property	RoomsBelowGrade	Rooms +	Number	
property	RoomsTotal	Rooms Total	Number	
property	RuralUtilities	Rural Services	String List, Multi	
property	SalesBrochureUrl	Sales Brochure URL	String	
property	SaunaYN	Sauna YN	Boolean	
property	SeasonalDwelling	Seasonal Dwelling	Boolean	
property	SeatingCapacity	Seats	Number	
property	SecurityFeatures	Sprinklers	String List, Multi	
property	SeniorCommunityYN	Retirement Community	Boolean	
property	Sewage	Sewage	String List, Multi	
property	Sewer	Sewers	String List, Multi	
property	SewerYNA	Sewers	String List, Single	
property	Shoreline	Shoreline	String List, Multi	
property	ShorelineAllowance	Shoreline Allowance	String List, Single	
property	ShorelineExposure	Shoreline Exposure	String List, Single	
Property	ShorelineExposureMulti	Shoreline Exposure	String List, Multi	
media	ShortDescription	Short Description	String	
property	ShowingAppointments	Showing Appointments	String	
property	ShowingRequirements	Showing Requirements	String List, Multi	
property	SignOnPropertyYN	SignOnPropertyYN	Boolean	
property	SoilTest	Soil Test	String List, Single	
property	SoilType	SoilType	String List, Multi	
property	SoldArea	Sold Area	String	
property	SoldAreaCode	Sold Area Code	String List, Single	
property	SoldAreaUnits	Sold Area Units	String List, Single	
property	SoldConditionalEntryTimestamp	Sold Conditional Timestamp	Timestamp	
property	SoldEntryTimestamp	Sold Timestamp	Timestamp	
property	SoundBiteUrl	Sound Bite URL	String	
media	SourceSystemID	Source System ID	String	
property	SourceSystemID	Source System ID	String	
media	SourceSystemMediaKey	Source System Media Key	String	
media	SourceSystemName	Source System Name	String	
property	SourceSystemName	Source System Name	String	
property	SpaYN	Spa Yes/No	Boolean	
property	SpecialDesignation	SpecialDesignation	String List, Multi	
property	SquareFootSource	Square Foot Source	String	
property	SquashRacquet	Squash Racquet	String List, Single	
property	StandardStatus	Standard Status	String List, Single	
property	StateOrProvince	Province	String List, Single	
property	StatisCauseInternal	Statis Cause Internal	String	
property	StatusCertificateYN	Status Certificate	Boolean	
property	Status_aur	Status_aur	String	
property	StreetDirPrefix	StreetDirPrefix	String List, Single	
property	StreetDirSuffix	Street Direction	String List, Single	
property	StreetName	Street Name	String	
property	StreetNumber	Street Number	String	
property	StreetSuffix	Abbreviation	String List, Single	
property	StreetSuffixCode	Street Suffix Code	String	
property	StructureType	Structure Type	String List, Multi	
property	SurveyAvailableYN	Survey	Boolean	
property	SurveyType	Survey Type	String List, Single	
property	SuspendedDate	Suspended Date	Date	
property	SuspendedEntryTimestamp	Suspended Timestamp	Timestamp	
property	SystemModificationTimestamp	System Modification Timestamp	Timestamp	
property	TMI	TMI	String	
property	TaxAnnualAmount	Taxes	Number	
property	TaxAssessedValue	Assessment	Number	
property	TaxBookNumber	Tax Book Number	String	
property	TaxLegalDescription	Legal Description	String	
property	TaxType	Type Taxes	String List, Single	
property	TaxYear	Tax Year	Number	
property	TaxesExpense	Taxes Expense	Number	
property	TelephoneYNA	Telephone	String List, Single	
property	TerminatedDate	TerminatedDate	Date	
property	TerminatedEntryTimestamp	Terminated Timestamp	Timestamp	
property	TimestampSQL	TimestampSQL	Timestamp	
property	Topography	Topography	String List, Multi	
property	TotalExpenses	Total Expenses	String	
property	Town	Town	String	
property	TrailerParkingSpots	Number of Trailer Parking Spots	Number	
property	TransactionBrokerCompensation	Commission to Co-Operating Brokerage	String	
property	TransactionType	Lease	String List, Single	
property	TruckLevelShippingDoors	Truck Level Shipping Doors #	Number	
property	TruckLevelShippingDoorsHeightFeet	Doors Height Feet	Number	
property	TruckLevelShippingDoorsHeightInches	Doors Height Inches	Number	
property	TruckLevelShippingDoorsWidthFeet	Doors Width Feet	Number	
property	TruckLevelShippingDoorsWidthInches	Doors Width Inches	Number	
property	UFFI	UFFI	String List, Single	
property	UnavailableDate	Unavailable Date	Date	
property	UnderContract	Under Contract	String List, Multi	
property	UnitNumber	Unit Number	String	
property	UnparsedAddress	Unparsed Address	String	
property	Utilities	Utilities	String List, Multi	
property	VacancyAllowance	Vacancy Allowance	Number	
property	VendorPropertyInfoStatement	Seller Property Info Statement	Boolean	
property	View	View	String List, Multi	
property	VirtualTourFlagYN	Virtual Tour Flag YN	Boolean	
property	VirtualTourURLBranded	Branded Virtual Tour URL 1	String	
property	VirtualTourURLBranded2	Branded Virtual Tour URL 2	String	
property	VirtualTourURLUnbranded	Virtual Tour URL	String	
Property	VirtualTourURLUnbranded2	Unbranded Virtual Tour URL 2	String	
property	Volts	Volts	Number	
property	WashroomsType1	# Washrooms	Number	
property	WashroomsType1Level	Level	String List, Single	
property	WashroomsType1Pcs	# Pieces	Number	
property	WashroomsType2	# Washrooms	Number	
property	WashroomsType2Level	Level	String List, Single	
property	WashroomsType2Pcs	# Pieces	Number	
property	WashroomsType3	# Washrooms	Number	
property	WashroomsType3Level	Level	String List, Single	
property	WashroomsType3Pcs	# Pieces	Number	
property	WashroomsType4	# Washrooms	Number	
property	WashroomsType4Level	Level	String List, Single	
property	WashroomsType4Pcs	# Pieces	Number	
property	WashroomsType5	# Washrooms	Number	
property	WashroomsType5Level	Level	String List, Single	
property	WashroomsType5Pcs	# Pieces	Number	
property	Water	Water	String List, Single	
property	WaterBodyName	Body Of Water Name	String	
property	WaterBodyType	Water Type	String List, Single	
property	WaterDeliveryFeature	Water Delivery Features	String List, Multi	
property	WaterExpense	Water Expense	Number	
property	WaterFrontageFt	Water Frontage (metres)	String	
Property	WaterFrontageUnits	Water Frontage Units	String List, Single	
property	WaterMeterYN	Water Meter	Boolean	
property	WaterSource	Water Supply Type	String List, Multi	
property	WaterView	Water View	String List, Multi	
property	WaterYNA	Water	String List, Single	
property	Waterfront	Waterfront	String List, Multi	
property	WaterfrontAccessory	Waterfront Accessory Buildings	String List, Multi	
property	WaterfrontFeatures	Waterfront Features	String List, Multi	
property	WaterfrontYN	Waterfront Yes/No	Boolean	
property	WellCapacity	Well Capacity (Gal/Minute)	Number	
Property	WellCapacityUnits	Well Capacity Units	String List, Single	
property	WellDepth	Well Depth (ft)	Number	
Property	WellDepthUnits	Well Depth Units	String List, Single	
property	Winterized	Winterized	String List, Single	
property	Year1LeasePrice	Year 1 Lease Price	String	
property	Year1LeasePriceHold	Year 1 Lease Price Hold	String	
property	Year2LeasePrice	Year 2 Lease Price	String	
property	Year2LeasePriceHold	Year 2 Lease Price Hold	String	
property	Year3LeasePrice	Year 3 Lease Price	String	
property	Year3LeasePriceHold	Year 3 Lease Price Hold	String	
property	Year4LeasePrice	Year 4 Lease Price	String	
property	Year4LeasePriceHold	Year 4 Lease Price Hold	String	
property	Year5LeasePrice	Year 5 Lease Price	String	
property	Year5LeasePriceHold	Year 5 Lease Price Hold	String	
property	YearExpenses	Year Expenses	Number	
property	Zoning	Zoning	String	
property	ZoningDesignation	Zoning	String	


IDX API Payload-

Resource	Standard Name	Display Name	Type	Key
property	AccessToProperty	Access To Property	String List, Multi	
property	AccessibilityFeatures	Accessibility Features	String List, Multi	
property	AdditionalMonthlyFee	POTL Monthly Fee	Number	
property	AdditionalMonthlyFeeFrequency	Additional Monthly Fee Frequency	String List, Single	
property	AlternativePower	Alternative Power	String List, Multi	
property	Amps	Amps	Number	
property	ApartmentNumber	Apartment Number	String	
property	ApproximateAge	Approximate Age	String List, Single	
property	ArchitecturalStyle	Style	String List, Multi	
property	AssessmentYear	Assessment Year	Number	
property	AssociationAmenities	Building Amenities	String List, Multi	
property	AssociationFee	Maintenance	Number	
property	AssociationFeeIncludes	Included in Maintenance Costs	String List, Multi	
property	AssociationName	Condo Registry Office	String	
property	AttachedGarageYN	Attached Garage Yes/No	Boolean	
property	BalconyType	Balcony	String List, Single	
property	Basement	Basement	String List, Multi	
property	BasementYN	Basement	Boolean	
property	BathroomsTotalInteger	Washrooms	Number	
property	BaySizeLengthFeet	Length Feet	Number	
property	BaySizeLengthInches	Length Inches	Number	
property	BaySizeWidthFeet	Width Feet	Number	
property	BaySizeWidthInches	Width Inches	Number	
property	BedroomsAboveGrade	# of Bedrooms	Number	
property	BedroomsBelowGrade	Bedrooms +	Number	
property	BedroomsTotal	Bedrooms Total	Number	
property	BoardPropertyType	Board Property Type	String List, Single	
property	BuilderName	Builder Name	String	
property	BuildingAreaTotal	Total Area	Number	
property	BuildingAreaUnits	Total Area Code	String List, Single	
property	BuildingName	Building Name	String	
property	BusinessName	Business/ Building Name	String	
property	BusinessType	Use	String List, Multi	
property	CableYNA	Cable	String List, Single	
property	CentralVacuumYN	Central Vacuum	Boolean	
property	ChannelName	Channel Name	String	
property	ChattelsYN	Chattels	Boolean	
property	City	Municipality	String List, Single	
property	CityRegion	Community	String	
media	ClassName	Class Name	String List, Single	
property	ClearHeightFeet	Clear Height Feet	Number	
property	ClearHeightInches	Clear Height Inches	Number	
property	CoListOfficeKey	Co-List Office Key	String	
Property	CoListOfficeKey3	Broker 3/Salesperson 3 Office Key	String	
Property	CoListOfficeKey4	Broker 4/Salesperson 4 Office Key	String	
property	CoListOfficeName	Co-List Office Name	String	
Property	CoListOfficeName3	Broker 3/Salesperson 3 Brokerage	String	
Property	CoListOfficeName4	Broker 4/Salesperson 4 Brokerage	String	
property	CommercialCondoFee	Condo Maintenance Fees Monthly	Number	
property	CommercialCondoFeeFrequency	CommercialCondoFeeFrequency	String List, Single	
property	CommonAreaUpcharge	Common Area Upcharge	Number	
property	CommunityFeatures	Area Influences	String List, Multi	
property	CondoCorpNumber	Condo Corp Number	Number	
property	ConstructionMaterials	Exterior	String List, Multi	
property	ContractStatus	ContractStatus	String List, Single	
property	Cooling	Air Conditioning	String List, Multi	
property	CoolingYN	Cooling Yes/No	Boolean	
property	Country	Country	String List, Single	
property	CountyOrParish	Area	String List, Single	
property	CoveredSpaces	Garage Parking Spaces	Number	
property	CraneYN	Crane	Boolean	
property	CrossStreet	Direction/ Main Cross Streets	String	
property	DDFYN	Distribute to DDF/IDX	Boolean	
property	DenFamilyroomYN	Family Room	Boolean	
property	DevelopmentChargesPaid	Development Charges Paid	String List, Multi	
property	DirectionFaces	Fronting On	String List, Single	
property	Directions	Directions	String	
property	Disclosures	Easements/ Restrictions	String List, Multi	
property	DockingType	DockingType	String List, Multi	
property	DoubleManShippingDoors	Double Man Shipping Doors #	Number	
property	DoubleManShippingDoorsHeightFeet	Doors Height Feet	Number	
property	DoubleManShippingDoorsHeightInches	Doors Height Inches	Number	
property	DoubleManShippingDoorsWidthFeet	Doors Width Feet	Number	
property	DoubleManShippingDoorsWidthInches	Doors Width Inches	Number	
property	DriveInLevelShippingDoors	Drive-In Level Shipping Doors #	Number	
property	DriveInLevelShippingDoorsHeightFeet	Doors Height Feet	Number	
property	DriveInLevelShippingDoorsHeightInches	Doors Height Inches	Number	
property	DriveInLevelShippingDoorsWidthFeet	Doors Width Feet	Number	
property	DriveInLevelShippingDoorsWidthInches	Doors Width Inches	Number	
property	ElectricExpense	Hydro Expense	Number	
property	ElectricOnPropertyYN	Electric On Property Yes/No	Boolean	
property	ElectricYNA	Hydro	String List, Single	
property	ElevatorType	Elevator	String List, Single	
property	ElevatorYN	Elevator/ Lift	Boolean	
property	EnsuiteLaundryYN	Ensuite Laundry	Boolean	
property	EstimatedInventoryValueAtCost	Estimated Inventory Value At Cost	Number	
property	Expenses	Expenses Actual/Estimated	String List, Single	
property	ExpirationDate	Expiry Date	Date	
property	Exposure	Exposure	String List, Single	
property	ExteriorFeatures	Exterior Features	String List, Multi	
property	FarmFeatures	FarmFeatures	String List, Multi	
property	FarmType	Farm/ Agriculture	String List, Multi	
property	FinancialStatementAvailableYN	Financial Statement	Boolean	
property	FireplaceFeatures	Fireplace Features	String List, Multi	
property	FireplaceYN	Fireplace/ Stove	Boolean	
property	FoundationDetails	Foundation Details	String List, Multi	
property	FranchiseYN	Franchise	Boolean	
property	FreestandingYN	Freestanding	Boolean	
property	FrontageLength	Lot Front	String	
property	Furnished	Furnished	String List, Single	
property	GarageParkingSpaces	Garage Parking Spaces	String	
property	GarageType	Garage Type	String List, Single	
property	GarageYN	Garage Yes/No	Boolean	
property	GradeLevelShippingDoors	Grade Level Shipping Doors #	Number	
property	GradeLevelShippingDoorsHeightFeet	Doors Height Feet	Number	
property	GradeLevelShippingDoorsHeightInches	Doors Height Inches	Number	
property	GradeLevelShippingDoorsWidthFeet	Doors Width Feet	Number	
property	GradeLevelShippingDoorsWidthInches	Doors Width Inches	Number	
property	HSTApplication	HST Applicable to Sale Price	String List, Multi	
property	HeatSource	Heat Source	String List, Single	
Property	HeatSourceMulti	Heat Source	String List, Multi	
property	HeatType	Heat Type	String List, Single	
Property	HeatTypeMulti	Heat Type	String List, Multi	
property	HeatingExpenses	Heat Expense	Number	
property	HeatingYN	Heating Yes/No	Boolean	
property	HoursDaysOfOperation	Days Open	String List, Multi	
property	HoursDaysOfOperationDescription	Hours Open	String	
media	ImageOf	Image Of	String List, Single	
media	ImageSizeDescription	Image Size	String List, Single	
property	IndustrialArea	Industrial Area	Number	
property	IndustrialAreaCode	Industrial Area Code	String List, Single	
property	InsuranceExpense	Insurance Expense	Number	
property	InteriorFeatures	Interior Features	String List, Multi	
property	InternetAddressDisplayYN	Display Address on Internet	Boolean	
property	InternetEntireListingDisplayYN	Distribute to Internet	Boolean	
property	IslandYN	Island	Boolean	
property	KitchensAboveGrade	# of Kitchens	Number	
property	KitchensBelowGrade	Kitchens +	Number	
property	KitchensTotal	# of Kitchens	Number	
property	LaundryFeatures	Laundry Access	String List, Multi	
property	LeaseToOwnEquipment	Lease To Own Equipment	String List, Multi	
property	LeasedLandFee	Leased Land Fee	Number	
property	LeasedTerms	Leased Terms	String	
property	LegalStories	Level	String	
property	LinkProperty	Link Property	String	
property	LinkYN	LINK	Boolean	
property	ListAOR	List AOR	String List, Single	
property	ListOfficeKey	Listing Brokerage	String	
property	ListOfficeName	List Office Name	String	
property	ListPrice	List Price	Number	
property	ListPriceUnit	List Price Code	String List, Single	
propertyrooms	ListingID	Listing ID	String	
openhouse	ListingKey	Listing Key	String	
property	ListingKey	Listing Key	String	
propertyrooms	ListingKey	Listing Key	String	
property	LivingAreaRange	Approximate Square Footage	String List, Single	
property	LocalImprovements	Local Improvements	Boolean	
property	LocalImprovementsComments	Local Improvements Comments	String	
property	Locker	Locker	String List, Single	
property	LockerLevel	Locker Level	String	
property	LockerNumber	Locker Number	String	
property	LockerUnit	Locker Unit	String	
property	LotDepth	Lot Depth	Number	
property	LotDimensionsSource	Lot Dimensions Source	String List, Single	
property	LotFeatures	Lot Features	String List, Multi	
property	LotIrregularities	Lot Irregularities	String	
property	LotShape	Lot Shape	String List, Single	
property	LotSizeArea	Lot Size Area	Number	
property	LotSizeAreaUnits	Lot Size Area Code	String	
property	LotSizeRangeAcres	Acreage	String List, Single	
property	LotSizeSource	Lot Size Source	String List, Single	
property	LotSizeUnits	Lot Size Code	String List, Single	
property	LotType	Lot/ Building/ Unit Code	String List, Single	
property	LotWidth	Lot Width/Frontage	Number	
property	MaximumRentalMonthsTerm	Maximum Rental Term Months	Number	
media	MediaCategory	Media Category	String List, Single	
property	MediaChangeTimestamp	Media Change Timestamp	Timestamp	
media	MediaKey	Media Key	String	
visualattribute	MediaKey	Media Key	String	
property	MediaListingKey	Media Listing Key	String	
media	MediaModificationTimestamp	Media Modification Timestamp	Timestamp	
media	MediaObjectID	Media Object ID	String	
media	MediaStatus	Media Status	String List, Single	
media	MediaType	Media Type	String List, Single	
media	MediaURL	Media URL	String	
property	MinimumRentalTermMonths	Minimum Rental Term Months	Number	
property	MlsStatus	MLS Status	String List, Single	
media	ModificationTimestamp	Modification Timestamp	Timestamp	
openhouse	ModificationTimestamp	Modification Timestamp	Timestamp	
property	ModificationTimestamp	Modification Timestamp	Timestamp	
propertyrooms	ModificationTimestamp	Modification Timestamp	Timestamp	
property	NetOperatingIncome	Net Income Before Debt	Number	
property	NewConstructionYN	New Construction Yes/No	Boolean	
property	NumberOfFullTimeEmployees	Employees	Number	
property	NumberOfKitchens	Number Of Kitchens	String	
property	OccupantType	Occupancy	String List, Single	
property	OfficeApartmentArea	Office Apartment Area	Number	
property	OfficeApartmentAreaUnit	Office Apartment Area Code	String List, Single	
office	OfficeKey	Office Key	String	
office	OfficeName	Office Name	String	
openhouse	OpenHouseDate	Open House Date	Date	
openhouse	OpenHouseEndTime	Open House End Time	Timestamp	
OpenHouse	OpenHouseFormat	Open House Format	String List, Single	
openhouse	OpenHouseKey	Open House Key	String	
openhouse	OpenHouseStartTime	Open House Start Time	Timestamp	
openhouse	OpenHouseStatus	Open House Status	String List, Single	
openhouse	OpenHouseType	Open House Type	String List, Single	
OpenHouse	OpenHouseURL	Open House URL	String	
media	Order	Order	Number	
PropertyRooms	Order	Order	Number	
property	OriginalEntryTimestamp	Original Entry Timestamp	Timestamp	
media	OriginatingSystemID	Originating System ID	String	
office	OriginatingSystemID	Originating System ID	String	
property	OriginatingSystemID	Originating System ID	String	
property	OtherExpense	Other Expense	Number	
property	OtherStructures	Other Structures	String List, Multi	
property	OutOfAreaMunicipality	Out Of Area Municipality	String	
property	OutsideStorageYN	Outside Storage	Boolean	
property	ParcelNumber	PIN#	String	
Property	ParcelNumber2	Additional PIN #	Number	
property	ParcelOfTiedLand	Parcel of Tied Land	String List, Single	
property	ParkingFeatures	Parking Features	String List, Multi	
property	ParkingLevelUnit1	Parking Level/Unit 1	String	
property	ParkingLevelUnit2	Parking Level/Unit 2	String	
property	ParkingMonthlyCost	Parking Cost/ Month	Number	
property	ParkingSpaces	Parking Spaces	Number	
property	ParkingSpot1	Parking Spot 1	String	
property	ParkingSpot2	Parking Spot 2	String	
property	ParkingTotal	Total Parking Spaces	Number	
property	PercentBuilding	% Building	String	
property	PetsAllowed	Pets Permitted	String List, Multi	
property	PhotosChangeTimestamp	Photos Change Timestamp	Timestamp	
property	PoolFeatures	Pool	String List, Multi	
property	PossessionDetails	Possession Remarks	String	
property	PossessionType	Possession Type	String List, Single	
property	PostalCode	Postal Code	String	
media	PreferredPhotoYN	Preferred Photo YN	Boolean	
property	ProfessionalManagementExpense	Management Expense	Number	
property	PropertyAttachedYN	Property Attached Yes/No	Boolean	
property	PropertyFeatures	Property Features/ Area Influences	String List, Multi	
property	PropertyManagementCompany	Property Management Company	String	
property	PropertySubType	Type	String List, Single	
property	PropertyType	Property Type	String List, Single	
property	PropertyUse	Category	String List, Single	
property	PublicRemarks	Remarks For Clients	String	
property	PublicRemarksExtras	Extras	String	
property	Rail	Rail	String List, Single	
property	RentIncludes	Included in Lease Cost	String List, Multi	
media	ResourceName	Resource Name	String List, Single	
media	ResourceRecordKey	Resource Record Key	String	
property	RetailArea	Retail Area	Number	
property	RetailAreaCode	Retail Area Code	String List, Single	
property	RoadAccessFee	Road Access Fee	Number	
property	RollNumber	Assessment Roll Number (ARN)	String	
property	Roof	Roof	String List, Multi	
propertyrooms	RoomArea	Room Area	Number	
propertyrooms	RoomAreaSource	Room Area Source	String List, Single	
propertyrooms	RoomAreaUnits	Room Area Units	String List, Single	
propertyrooms	RoomDescription	Room Description	String	
propertyrooms	RoomDimensions	Room Dimensions	String	
propertyrooms	RoomFeature1	Room Feature 1	String List, Single	
propertyrooms	RoomFeature2	Room Feature 2	String List, Single	
propertyrooms	RoomFeature3	Room Feature 3	String List, Single	
propertyrooms	RoomFeatures	Room Features	String List, Multi	
property	RoomHeight	RoomHeight	Number	
propertyrooms	RoomHeight	RoomHeight	Number	
propertyrooms	RoomKey	Room Key	String	
propertyrooms	RoomLength	Room Length	Number	
propertyrooms	RoomLengthWidthUnits	Room Length/Width Units	String List, Single	
propertyrooms	RoomLevel	Room Level	String List, Single	
property	RoomType	Room Type	String List, Multi	
propertyrooms	RoomType	Room Type	String List, Single	
propertyrooms	RoomWidth	Room Width	Number	
property	RoomsAboveGrade	# of Rooms	Number	
property	RoomsBelowGrade	Rooms +	Number	
property	RoomsTotal	Rooms Total	Number	
property	RuralUtilities	Rural Services	String List, Multi	
property	SeasonalDwelling	Seasonal Dwelling	Boolean	
property	SeatingCapacity	Seats	Number	
property	SecurityFeatures	Sprinklers	String List, Multi	
property	SeniorCommunityYN	Retirement Community	Boolean	
property	Sewer	Sewers	String List, Multi	
property	Shoreline	Shoreline	String List, Multi	
property	ShorelineAllowance	Shoreline Allowance	String List, Single	
Property	ShorelineExposureMulti	Shoreline Exposure	String List, Multi	
media	ShortDescription	Short Description	String	
property	ShowingRequirements	Showing Requirements	String List, Multi	
property	SignOnPropertyYN	SignOnPropertyYN	Boolean	
property	SoilTest	Soil Test	String List, Single	
property	SoilType	SoilType	String List, Multi	
property	SpaYN	Spa Yes/No	Boolean	
property	SpecialDesignation	SpecialDesignation	String List, Multi	
property	SquareFootSource	Square Foot Source	String	
property	StandardStatus	Standard Status	String List, Single	
property	StateOrProvince	Province	String List, Single	
property	StreetDirPrefix	StreetDirPrefix	String List, Single	
property	StreetDirSuffix	Street Direction	String List, Single	
property	StreetName	Street Name	String	
property	StreetNumber	Street Number	String	
property	StreetSuffix	Abbreviation	String List, Single	
property	StructureType	Structure Type	String List, Multi	
property	SurveyAvailableYN	Survey	Boolean	
property	SurveyType	Survey Type	String List, Single	
property	SystemModificationTimestamp	System Modification Timestamp	Timestamp	
property	TaxAnnualAmount	Taxes	Number	
property	TaxAssessedValue	Assessment	Number	
property	TaxLegalDescription	Legal Description	String	
property	TaxType	Type Taxes	String List, Single	
property	TaxYear	Tax Year	Number	
property	TimestampSQL	TimestampSQL	Timestamp	
property	Topography	Topography	String List, Multi	
property	TransactionType	Lease	String List, Single	
property	TruckLevelShippingDoors	Truck Level Shipping Doors #	Number	
property	TruckLevelShippingDoorsHeightFeet	Doors Height Feet	Number	
property	TruckLevelShippingDoorsHeightInches	Doors Height Inches	Number	
property	TruckLevelShippingDoorsWidthFeet	Doors Width Feet	Number	
property	TruckLevelShippingDoorsWidthInches	Doors Width Inches	Number	
property	UFFI	UFFI	String List, Single	
property	UnderContract	Under Contract	String List, Multi	
property	UnitNumber	Unit Number	String	
property	UnparsedAddress	Unparsed Address	String	
property	Utilities	Utilities	String List, Multi	
property	VacancyAllowance	Vacancy Allowance	Number	
property	VendorPropertyInfoStatement	Seller Property Info Statement	Boolean	
property	View	View	String List, Multi	
property	VirtualTourFlagYN	Virtual Tour Flag YN	Boolean	
property	VirtualTourURLBranded	Branded Virtual Tour URL 1	String	
property	VirtualTourURLBranded2	Branded Virtual Tour URL 2	String	
property	VirtualTourURLUnbranded	Virtual Tour URL	String	
Property	VirtualTourURLUnbranded2	Unbranded Virtual Tour URL 2	String	
property	WashroomsType1	# Washrooms	Number	
property	WashroomsType1Level	Level	String List, Single	
property	WashroomsType1Pcs	# Pieces	Number	
property	WashroomsType2	# Washrooms	Number	
property	WashroomsType2Level	Level	String List, Single	
property	WashroomsType2Pcs	# Pieces	Number	
property	WashroomsType3	# Washrooms	Number	
property	WashroomsType3Level	Level	String List, Single	
property	WashroomsType3Pcs	# Pieces	Number	
property	WashroomsType4	# Washrooms	Number	
property	WashroomsType4Level	Level	String List, Single	
property	WashroomsType4Pcs	# Pieces	Number	
property	WashroomsType5	# Washrooms	Number	
property	WashroomsType5Level	Level	String List, Single	
property	WashroomsType5Pcs	# Pieces	Number	
property	WaterBodyName	Body Of Water Name	String	
property	WaterBodyType	Water Type	String List, Single	
property	WaterDeliveryFeature	Water Delivery Features	String List, Multi	
property	WaterExpense	Water Expense	Number	
property	WaterFrontageFt	Water Frontage (metres)	String	
Property	WaterFrontageUnits	Water Frontage Units	String List, Single	
property	WaterSource	Water Supply Type	String List, Multi	
property	WaterView	Water View	String List, Multi	
property	Waterfront	Waterfront	String List, Multi	
property	WaterfrontAccessory	Waterfront Accessory Buildings	String List, Multi	
property	WaterfrontFeatures	Waterfront Features	String List, Multi	
property	WaterfrontYN	Waterfront Yes/No	Boolean	
property	WellCapacity	Well Capacity (Gal/Minute)	Number	
Property	WellCapacityUnits	Well Capacity Units	String List, Single	
property	WellDepth	Well Depth (ft)	Number	
Property	WellDepthUnits	Well Depth Units	String List, Single	
property	ZoningDesignation	Zoning	String	

