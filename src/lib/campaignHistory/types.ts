/** Campaign-history domain types. One CampaignEvent == one listing (campaign). */

export type TransactionKind = 'Sale' | 'Lease';
export type CampaignStatus = 'Active' | 'Terminated' | 'Expired' | 'Suspended' | 'Sold' | 'Leased';

/** One campaign (listing) at a physical address, normalized from the VOW feed. */
export interface CampaignEvent {
  listing_key: string;
  transaction_type: TransactionKind;
  status: CampaignStatus;
  entry_date: string | null;        // OriginalEntryTimestamp (ISO)
  end_date: string | null;          // resolved terminal date for the status
  end_reason: CampaignStatus | null; // null while Active
  list_price: number | null;        // last/current list price for the campaign
  original_list_price: number | null;
  close_price: number | null;       // Sold only
  brokerage: string | null;         // ListOfficeName
  price_change_date: string | null; // PriceChangeTimestamp (one net change per campaign)
  address: string | null;           // UnparsedAddress
}

/** Result of computeTrueDomFromCampaigns. */
export interface CampaignTrueDom {
  true_dom: number;
  total_price_drop: number;
  campaign_count: number;
  is_stale: boolean;
}
