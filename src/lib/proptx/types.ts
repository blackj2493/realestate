// ProptX VOW (Virtual Office Website) API Types
// Based on official VOW Payload documentation

// ============ Property Types ============

export interface Property {
  // Basic Info
  ListingKey: string;
  ListingId?: string;
  MlsStatus?: string;
  StandardStatus?: string;
  ContractStatus?: string;
  
  // Property Details
  PropertyType?: string;
  PropertySubType?: string;
  PropertyUse?: string;
  
  // Location
  City?: string;
  CityRegion?: string;
  StateOrProvince?: string;
  PostalCode?: string;
  UnparsedAddress?: string;
  StreetNumber?: string;
  StreetName?: string;
  StreetDirPrefix?: string;
  StreetDirSuffix?: string;
  StreetSuffix?: string;
  StreetSuffixCode?: string;
  UnitNumber?: string;
  ApartmentNumber?: string;
  LegalApartmentNumber?: string;
  Country?: string;
  CountyOrParish?: string;
  Township?: string;
  Town?: string;
  OutOfAreaMunicipality?: string;
  CrossStreet?: string;
  DirectionFaces?: string;
  Directions?: string;
  
  // Price
  ListPrice?: number;
  ClosePrice?: number;
  OriginalListPrice?: number;
  PreviousListPrice?: number;
  ListPriceUnit?: string;
  OriginalListPriceUnit?: string;
  PriorPriceCode?: string;
  PriceChangeTimestamp?: string;
  CloseDateHold?: string;
  ClosePriceHold?: number;
  
  // Building
  BuildingAreaTotal?: number;
  BuildingAreaUnits?: string;
  BuildingName?: string;
  ConstructionMaterials?: string[];
  ArchitecturalStyle?: string[];
  FoundationDetails?: string[];
  Roof?: string[];
  ExteriorFeatures?: string[];
  StructureType?: string[];
  
  // Rooms
  BedroomsTotal?: number;
  BedroomsAboveGrade?: number;
  BedroomsBelowGrade?: number;
  BathroomsTotalInteger?: number;
  KitchensTotal?: number;
  KitchensAboveGrade?: number;
  KitchensBelowGrade?: number;
  RoomsTotal?: number;
  RoomsAboveGrade?: number;
  RoomsBelowGrade?: number;
  LivingAreaRange?: string;
  
  // Parking
  GarageParkingSpaces?: string;
  GarageType?: string;
  GarageYN?: boolean;
  AttachedGarageYN?: boolean;
  CarportSpaces?: number;
  CoveredSpaces?: number;
  ParkingSpaces?: number;
  ParkingTotal?: number;
  ParkingType1?: string;
  ParkingType2?: string;
  ParkingLevelUnit1?: string;
  ParkingLevelUnit2?: string;
  ParkingSpot1?: string;
  ParkingSpot2?: string;
  ParkingMonthlyCost?: number;
  ParkingFeatures?: string[];
  
  // Land
  LotSizeArea?: number;
  LotSizeUnits?: string;
  LotSizeAreaUnits?: string;
  LotWidth?: number;
  LotDepth?: number;
  LotDimensionsSource?: string;
  LotSizeSource?: string;
  LotShape?: string;
  LotIrregularities?: string;
  LotFeatures?: string[];
  LotType?: string;
  LotSizeDimensions?: string;
  LotSizeRangeAcres?: string;
  FrontageLength?: string;
  
  // Utilities
  HeatingYN?: boolean;
  HeatType?: string;
  HeatTypeMulti?: string[];
  HeatSource?: string;
  HeatSourceMulti?: string[];
  HeatingExpenses?: number;
  CoolingYN?: boolean;
  Cooling?: string[];
  ElectricYNA?: string;
  ElectricOnPropertyYN?: boolean;
  ElectricExpense?: number;
  GasYNA?: string;
  WaterYNA?: string;
  WaterSource?: string[];
  Sewer?: string[];
  SewerYNA?: string;
  Utilities?: string[];
  
  // Interior
  FireplaceYN?: boolean;
  FireplacesTotal?: number;
  FireplaceFeatures?: string[];
  LaundryLevel?: string;
  LaundryFeatures?: string[];
  InteriorFeatures?: string[];
  ElevatorYN?: boolean;
  ElevatorType?: string;
  CentralVacuumYN?: boolean;
  
  // Basement
  BasementYN?: boolean;
  Basement?: string[];
  DenFamilyroomYN?: boolean;
  RecreationRoomYN?: boolean;
  
  // Exterior
  ExteriorFinish?: string[];
  Fencing?: string;
  
  // Water & Pool
  WaterfrontYN?: boolean;
  Waterfront?: string[];
  WaterfrontFeatures?: string[];
  WaterBodyName?: string;
  WaterBodyType?: string;
  Shoreline?: string[];
  ShorelineExposure?: string;
  ShorelineExposureMulti?: string[];
  PoolFeatures?: string[];
  PoolType?: string[];
  SpaYN?: boolean;
  SaunaYN?: boolean;
  
  // View
  View?: string[];
  WaterView?: string[];
  
  // Green/Energy
  GreenPropertyInformationStatement?: boolean;
  GreenCertificationLevel?: string;
  
  // Zoning & Land
  Zoning?: string;
  ZoningDesignation?: string;
  FarmType?: string[];
  FarmFeatures?: string[];
  
  // Condo/Association
  AssociationFee?: number;
  AssociationFeeIncludes?: string[];
  AssociationName?: string;
  AssociationYN?: boolean;
  AssociationAmenities?: string[];
  CondoCorpNumber?: number;
  AdditionalMonthlyFee?: number;
  AdditionalMonthlyFeeFrequency?: string;
  MaintenanceExpense?: number;
  Locker?: string;
  LockerLevel?: string;
  LockerNumber?: string;
  LockerUnit?: string;
  
  // Amenities
  Amenities?: string[];
  CommunityFeatures?: string[];
  PropertyFeatures?: string[];
  
  // Pets
  PetRestrictiveCovenants?: string;
  PetsAllowed?: string[];
  
  // Rooms (detailed)
  RoomType?: string[];
  AccessibilityFeatures?: string[];
  
  // Commercial
  BusinessType?: string[];
  BusinessName?: string;
  IndustrialArea?: number;
  IndustrialAreaCode?: string;
  OfficeApartmentArea?: number;
  OfficeApartmentAreaUnit?: string;
  RetailArea?: number;
  RetailAreaCode?: string;
  
  // Rental
  TransactionType?: string;
  LeaseAmount?: number;
  LeaseTerm?: string;
  LeasedLandFee?: number;
  LeasedTerms?: string;
  RentIncludes?: string[];
  
  // Possession
  ListingContractDate?: string;
  PossessionDate?: string;
  PossessionType?: string;
  PossessionDetails?: string;
  
  // Listing Info
  OriginatingSystemID?: string;
  OriginatingSystemKey?: string;
  OriginatingSystemName?: string;
  SourceSystemID?: string;
  SourceSystemName?: string;
  ListOfficeName?: string;
  ListAgentFullName?: string;
  CoListOfficeName?: string;
  CoListAgentAOR?: string;
  BuyerOfficeName?: string;
  CoBuyerOfficeName?: string;
  BrokerFaxNumber?: string;
  
  // Dates
  ExpirationDate?: string;
  MajorChangeTimestamp?: string;
  OriginalEntryTimestamp?: string;
  PhotosChangeTimestamp?: string;
  MediaChangeTimestamp?: string;
  ModificationTimestamp?: string;
  SystemModificationTimestamp?: string;
  BackOnMarketEntryTimestamp?: string;
  
  // Days & Status
  DaysOnMarket?: number;
  PriorMlsStatus?: string;
  BoardPropertyType?: string;
  
  // Remarks
  PublicRemarks?: string;
  PublicRemarksExtras?: string;
  PrivateRemarks?: string;
  Exclusions?: string;
  Inclusions?: string;
  
  // Tax
  TaxAnnualAmount?: number;
  TaxAssessedValue?: number;
  TaxYear?: number;
  AssessmentYear?: number;
  TaxBookNumber?: string;
  TaxType?: string[];
  TaxLegalDescription?: string;
  LocalImprovements?: boolean;
  LocalImprovementsComments?: string;
  TMI?: string;
  
  // Additional
  ApproximateAge?: string;
  NewConstructionYN?: boolean;
  VirtualTourURLBranded?: string;
  VirtualTourURLBranded2?: string;
  VirtualTourURLUnbranded?: string;
  VirtualTourURLUnbranded2?: string;
  VirtualTourFlagYN?: boolean;
  
  // Other
  SurveyAvailableYN?: boolean;
  SurveyType?: string[];
  Topography?: string[];
  WaterMeterYN?: boolean;
  WellCapacity?: number;
  WellDepth?: number;
  AlternativePower?: string[];
  
  // Computed fields
  DisplayPrice?: number;
  Bathrooms?: number;
  Bedrooms?: number;
  
  // For indexing
  [key: string]: unknown;
}

// ============ Media Types ============

export interface Media {
  MediaKey: string;
  MediaObjectID?: string;
  MediaModificationTimestamp?: string;
  MediaType?: string;
  MediaStatus?: string;
  MediaCategory?: string;
  MediaURL: string;
  ImageOf?: string[];
  ImageHeight?: number;
  ImageWidth?: number;
  ImageSizeDescription?: string;
  ShortDescription?: string;
  LongDescription?: string;
  MediaHTML?: string;
  ClassName?: string;
  Order?: number;
  PreferredPhotoYN?: boolean;
  ResourceName?: string[];
  ResourceRecordKey?: string;
  SourceSystemID?: string;
  SourceSystemMediaKey?: string;
  SourceSystemName?: string;
  Permission?: string[];
  ModificationTimestamp?: string;
}

// ============ Open House Types ============

export interface OpenHouse {
  OpenHouseKey: string;
  OpenHouseId?: string;
  ListingKey: string;
  OpenHouseDate: string;
  OpenHouseStartTime?: string;
  OpenHouseEndTime?: string;
  OpenHouseType?: string;
  OpenHouseFormat?: string[];
  OpenHouseStatus?: string;
  OpenHouseURL?: string;
  ModificationTimestamp?: string;
  OriginalEntryTimestamp?: string;
}

// ============ Property Rooms Types ============

export interface PropertyRoom {
  RoomKey: string;
  ListingKey: string;
  Order?: number;
  RoomType?: string[];
  RoomDescription?: string;
  RoomLevel?: string[];
  RoomLength?: number;
  RoomWidth?: number;
  RoomDimensions?: string;
  RoomArea?: number;
  RoomAreaSource?: string[];
  RoomAreaUnits?: string;
  RoomLengthWidthSource?: string[];
  RoomLengthWidthUnits?: string;
  RoomFeatures?: string[];
  RoomFeature1?: string[];
  RoomFeature2?: string[];
  RoomFeature3?: string[];
  RoomStatus?: string[];
  ModificationTimestamp?: string;
}

// ============ Office Types ============

export interface Office {
  OfficeKey: string;
  OfficeName: string;
}

// ============ Search Parameters ============

export interface PropertySearchParams {
  $top?: number;
  $skip?: number;
  $filter?: string;
  $orderby?: string;
  $select?: string;
  $count?: boolean;
  $expand?: string;
}

// ============ API Response Types ============

export interface PropertyResponse {
  value: Property[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

export interface MediaResponse {
  value: Media[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

export interface OpenHouseResponse {
  value: OpenHouse[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

export interface PropertyRoomResponse {
  value: PropertyRoom[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

// ============ Error Types ============

export interface ProptXError {
  error: {
    code: string;
    message: string;
    details?: string;
  };
}