// TypeScript interfaces for Ampre API data models

export interface Property {
  ListingKey: string;
  MlsStatus?: string;
  StandardStatus?: string;
  ContractStatus?: string;
  PropertyType?: string;
  PropertySubType?: string;
  City?: string;
  StateOrProvince?: string;
  PostalCode?: string;
  UnparsedAddress?: string;
  StreetNumber?: string;
  StreetName?: string;
  StreetDirPrefix?: string;
  StreetDirSuffix?: string;
  StreetSuffix?: string;
  UnitNumber?: string;
  ListPrice?: number;
  ClosePrice?: number;
  OriginalListPrice?: number;
  PreviousListPrice?: number;
  ListPriceUnit?: string;
  BedroomsTotal?: number;
  BathroomsTotalInteger?: number;
  KitchensTotal?: number;
  RoomsTotal?: number;
  LivingAreaRange?: string;
  LotSizeArea?: number;
  LotSizeUnits?: string;
  LotDimensionsSource?: string;
  LotWidth?: number;
  LotDepth?: number;
  LotSizeSource?: string;
  LotSizeAreaUnits?: string;
  BuildingAreaTotal?: number;
  BuildingAreaUnits?: string;
  ConstructionMaterials?: string[];
  ArchitecturalStyle?: string[];
  ExteriorFeatures?: string[];
  Fencing?: string;
  FoundationDetails?: string[];
  Roof?: string[];
  GarageParkingSpaces?: number;
  GarageType?: string;
  GarageYN?: boolean;
  AttachedGarageYN?: boolean;
  CarportSpaces?: number;
  CoveredSpaces?: number;
  ParkingSpaces?: number;
  ParkingTotal?: number;
  ParkingType1?: string;
  ParkingLevelUnit1?: string;
  ParkingLevelUnit2?: string;
  HeatingYN?: boolean;
  HeatType?: string;
  HeatTypeMulti?: string[];
  HeatSource?: string;
  HeatSourceMulti?: string[];
  CoolingYN?: boolean;
  Cooling?: string[];
  WaterSource?: string[];
  Sewer?: string[];
  Utilities?: string[];
  FireplaceYN?: boolean;
  FireplacesTotal?: number;
  FireplaceFeatures?: string[];
  LaundryLevel?: string;
  LaundryFeatures?: string[];
  ElevatorYN?: boolean;
  SecurityFeatures?: string[];
  View?: string[];
  WaterfrontYN?: boolean;
  Waterfront?: string[];
  WaterfrontFeatures?: string[];
  WaterBodyName?: string;
  PoolFeatures?: string[];
  SpaYN?: boolean;
  SaunaYN?: boolean;
  GreenPropertyInformationStatement?: string;
  GreenCertificationLevel?: string;
  Zoning?: string;
  ZoningDesignation?: string;
  FarmType?: string[];
  AdditionalMonthlyFee?: number;
  AdditionalMonthlyFeeFrequency?: string;
  AssociationFee?: number;
  AssociationFeeIncludes?: string[];
  AssociationName?: string;
  AssociationYN?: boolean;
  MaintenanceExpense?: number;
  CondoCorpNumber?: string;
  Locker?: string;
  LockerLevel?: string;
  LockerNumber?: string;
  LockerUnit?: string;
  Amenities?: string[];
  CommunityFeatures?: string[];
  PetRestrictiveCovenants?: string;
  PetsAllowed?: string[];
  RoomType?: string[];
  Basement?: string[];
  BasementYN?: boolean;
  ArchitecturalStyleDetail?: string[];
  AccessibilityFeatures?: string[];
  InteriorFeatures?: string[];
  ExteriorFinish?: string[];
  PoolType?: string[];
  StructureType?: string[];
  Topography?: string[];
  TransactionType?: string;
  ListingContractDate?: string;
  LeaseAmount?: number;
  LeaseTerm?: string;
  PossessionDate?: string;
  PossessionType?: string;
  Directions?: string;
  PublicRemarks?: string;
  PrivateRemarks?: string;
  Exclusions?: string;
  Inclusions?: string;
  Equipment?: string[];
  FarmBuildings?: string[];
  RentalEquipment?: string[];
  LeaseToOwnEquipment?: string[];
  ExpiryDate?: string;
  MajorChangeTimestamp?: string;
  OriginalEntryTimestamp?: string;
  PhotosChangeTimestamp?: string;
  MediaChangeTimestamp?: string;
  ListingId?: string;
  OriginatingSystemID?: string;
  OriginatingSystemKey?: string;
  OriginatingSystemName?: string;
  SourceSystemID?: string;
  SourceSystemName?: string;
  Township?: string;
  Area?: string;
  Municipality?: string;
  Community?: string;
  Subdivision?: string;
  AgentFullName?: string;
  AgentEmail?: string;
  AgentPhone?: string;
  ListOfficeName?: string;
  ListAgentFullName?: string;
  // Plus many more fields...
  [key: string]: unknown;
}

export interface PropertySearchParams {
  $top?: number;
  $skip?: number;
  $filter?: string;
  $orderby?: string;
  $select?: string;
  $count?: boolean;
  $expand?: string;
}

export interface AmpreApiResponse<T> {
  value: T[];
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
}

export interface AmpreError {
  error: {
    code: string;
    message: string;
  };
}

// Media Resource Types
// See: https://developer.ampre.ca/docs/getting-started

export interface Media {
  MediaKey: string;
  MediaURL?: string;
  MediaThumbnailURL?: string;
  MediaObjectId?: string;
  MediaCategory?: string;
  MediaType?: string;
  ImageSizeDescription?: string;
  ResourceName?: string;
  ResourceRecordKey?: string;
  ShortDescription?: string;
  LongDescription?: string;
  ModificationTimestamp?: string;
  OriginalEntryTimestamp?: string;
  // Office specific fields
  OfficeKey?: string;
  // Member specific fields
  MemberKey?: string;
  // Property specific fields
  ListingKey?: string;
  // Order and display
  MediaOrder?: number;
  [key: string]: unknown;
}

export interface MediaSearchParams {
  $top?: number;
  $skip?: number;
  $filter?: string;
  $orderby?: string;
  $select?: string;
  $count?: boolean;
  $expand?: string;
}

// Field Resource Types
// See: https://developer.ampre.ca/docs/field-resource
export interface Field {
  ResourceName?: string;
  FieldName?: string;
  ODataName?: string;
  DataType?: string;
  IsSearchable?: boolean;
  IsFilterable?: boolean;
  IsSortable?: boolean;
  IsNullable?: boolean;
  MaxLength?: number;
  Precision?: number;
  DisplayName?: string;
  Description?: string;
  SearchWeight?: number;
  ModifiedTimeStamp?: string;
  [key: string]: unknown;
}

export interface FieldSearchParams {
  $top?: number;
  $skip?: number;
  $filter?: string;
  $orderby?: string;
  $select?: string;
  $count?: boolean;
}

// Lookup Resource Types
// See: https://developer.ampre.ca/docs/lookup-resource
export interface Lookup {
  LookupName?: string;
  LookupValue?: string;
  LookupType?: string;
  ShortDescription?: string;
  LongDescription?: string;
  DisplayName?: string;
  DisplayOrder?: number;
  ModifiedTimeStamp?: string;
  [key: string]: unknown;
}

export interface LookupSearchParams {
  $top?: number;
  $skip?: number;
  $filter?: string;
  $orderby?: string;
  $select?: string;
  $count?: boolean;
}
