/**
 * Smart Homebuyer Command Center
 * 
 * 100vh "Command Center" interface for property search with:
 * - Top Command Bar (persona selector + Smart Homebuyer filters)
 * - Right Panel Ledger (high-density property list)
 * - 70/30 Split Terminal (property detail modal)
 */

"use client";

import React, { useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { 
  Map,
  Loader2,
  AlertCircle,
  LayoutDashboard
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Command Center Components
import {
  TopCommandBar,
  LedgerPanel,
  ListingTerminal,
} from "@/components/CommandCenter";

// Store
import { 
  useCommandCenterStore,
  getSmartHomebuyerFilterString,
  getMortgageHelperFilterString,
} from "@/lib/stores/commandCenterStore";

// Types
import type { ListingDocument, SearchResult } from "@/lib/typesense/client";

// ============================================================================
// Main Command Center Page
// ============================================================================

function CommandCenterContent() {
  const searchParams = useSearchParams();

  // Store state
  const {
    activePersona,
    smartFilters,
    searchResult,
    setSearchResult,
    isLoading,
    setIsLoading,
    error,
    setError,
    totalCount,
    setTotalCount,
    location,
    setLocation,
    selectedProperty,
    setSelectedProperty,
    isTerminalOpen,
    setIsTerminalOpen,
  } = useCommandCenterStore();

  // Initialize location from URL params
  useEffect(() => {
    const cityParam = searchParams.get("city") || searchParams.get("search") || "";
    if (cityParam && cityParam !== location) {
      setLocation(cityParam);
    }
  }, [searchParams, location, setLocation]);

  // Perform search with current filters
  const performSearch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: '1',
        limit: '200',
        type: 'buy',
        listingType: 'residential',
      });

      // Add location if set
      if (location) {
        params.set('city', location);
      }

      // Apply Smart Homebuyer filters
      if (activePersona === 'smart') {
        // Build filter string from persona filters
        const filterParts: string[] = [];

        // Max True Carry Cost (approximate via price)
        if (smartFilters.maxCarryCost < 10000) {
          const maxPrice = Math.floor((smartFilters.maxCarryCost / 0.004) * 1000);
          filterParts.push(`ListPrice:<=${maxPrice}`);
        }

        // Negotiation Leverage (True DOM)
        if (smartFilters.minTrueDOM > 0) {
          filterParts.push(`calculatedDOM:>=${smartFilters.minTrueDOM}`);
        }

        // CapEx Risk (ApproximateAge)
        switch (smartFilters.capExRisk) {
          case 'move-in-ready':
            filterParts.push(`ApproximateAge:<=10`);
            break;
          case 'light-tlc':
            filterParts.push(`ApproximateAge:>=10`);
            filterParts.push(`ApproximateAge:<=30`);
            break;
          case 'major-work':
            filterParts.push(`ApproximateAge:>=30`);
            break;
        }

        // Combine filter parts
        if (filterParts.length > 0) {
          params.set('filters', filterParts.join(' && '));
        }
      }

      const url = `/api/properties/listings?${params.toString()}`;
      console.log('[CommandCenter] Fetching:', url);

      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `API error ${response.status}`);
      }

      const data = await response.json();

      // Transform API response to SearchResult format
      const result: SearchResult = {
        listings: (data.listings || []).map((p: Record<string, unknown>) => ({
          id: p.ListingKey as string,
          ListPrice: p.ListPrice as number,
          UnparsedAddress: p.UnparsedAddress as string | undefined,
          City: p.City as string | undefined,
          PropertyType: p.PropertyType as string | undefined,
          PropertySubType: p.PropertySubType as string | undefined,
          BedroomsTotal: p.BedroomsTotal as number | undefined,
          BathroomsTotalInteger: p.BathroomsTotalInteger as number | undefined,
          BuildingAreaTotal: p.BuildingAreaTotal as number | undefined,
          calculatedDOM: p.DaysOnMarket as number | undefined,
          thumbnailUrl: p.primaryImageUrl as string | undefined,
          primaryImageUrl: p.primaryImageUrl as string | undefined,
          ListOfficeName: p.ListOfficeName as string | undefined,
          location: p.Latitude && p.Longitude 
            ? [p.Latitude as number, p.Longitude as number] 
            : [43.6532, -79.3832] as [number, number],
          isDistressed: (p.isDistressed as boolean) || false,
          hasSecondarySuitePotential: (p.hasSecondarySuitePotential as boolean) || false,
        })) as ListingDocument[],
        totalFound: data.pagination?.total || data.listings?.length || 0,
        page: data.pagination?.page || 1,
        perPage: data.pagination?.limit || 200,
        processingTimeMs: 0,
      };

      setSearchResult(result);
      setTotalCount(result.totalFound);

      console.log(`[CommandCenter] Found ${result.totalFound} listings`);
    } catch (err) {
      console.error("[CommandCenter] Search error:", err);
      setError(err instanceof Error ? err.message : "Search service temporarily unavailable.");
      setSearchResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [activePersona, smartFilters, location, setSearchResult, setIsLoading, setError, setTotalCount]);

  // Initial search and re-search on filter changes
  useEffect(() => {
    performSearch();
  }, [performSearch]);

  // Close terminal handler
  const handleCloseTerminal = useCallback(() => {
    setIsTerminalOpen(false);
  }, [setIsTerminalOpen]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Top Command Bar */}
      <TopCommandBar className="shrink-0" />

      {/* Main Content Area - Full Height */}
      <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 8rem)' }}>
        {/* Map Area - Left Side (70%) - Optional, can be hidden */}
        <div className="w-[70%] border-r border-slate-800 shrink-0 relative bg-slate-900">
          {/* Placeholder for map - could integrate AlphaMap here */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center p-6">
              <LayoutDashboard className="h-16 w-16 mx-auto mb-4 text-slate-700" />
              <p className="text-slate-500 font-medium mb-2">Map Integration Available</p>
              <p className="text-xs text-slate-600 mb-4">
                Click on properties in the ledger to view details
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-slate-600">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live MLS Feed Active</span>
              </div>
            </div>
          </div>

          {/* Coordinates overlay */}
          {searchResult && searchResult.listings.length > 0 && (
            <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-2">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Active Region</p>
              <p className="text-xs font-mono text-emerald-400">
                {searchResult.listings.length} properties loaded
              </p>
            </div>
          )}
        </div>

        {/* Right Panel Ledger (30%) - Scrollable */}
        <div className="w-[30%] flex flex-col bg-slate-950 shrink-0">
          <LedgerPanel className="flex-1" />
        </div>
      </div>

      {/* Footer */}
      <footer className="py-2 border-t border-slate-800 bg-slate-950 shrink-0">
        <div className="px-4 flex items-center justify-between text-[10px] text-slate-600">
          <span>PureProperty Command Center | Smart Homebuyer Mode</span>
          <span className="font-mono">
            {new Date().toLocaleDateString('en-US', { 
              weekday: 'short', 
              month: 'short', 
              day: 'numeric',
              year: 'numeric'
            })} | PROPTX MLS®
          </span>
        </div>
      </footer>

      {/* Listing Terminal Modal */}
      {selectedProperty && (
        <ListingTerminal
          property={selectedProperty}
          isOpen={isTerminalOpen}
          onClose={handleCloseTerminal}
        />
      )}
    </div>
  );
}

// Wrapper with Suspense for useSearchParams
export default function PropertiesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Initializing Command Center...</p>
        </div>
      </div>
    }>
      <CommandCenterContent />
    </Suspense>
  );
}