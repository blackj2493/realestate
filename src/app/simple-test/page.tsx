"use client";

import { useState, useEffect } from "react";
import { searchListings } from "@/lib/typesense/client";

export default function SimpleTestPage() {
  const [status, setStatus] = useState("initial");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function runSearch() {
      setStatus("searching...");
      try {
        console.log("Starting search...");
        const res = await searchListings({
          query: '*',
          filters: { transactionType: "For Sale" },
          page: 1,
          perPage: 10,
        });
        console.log("Search complete:", res);
        setStatus("complete");
        setResult(res);
      } catch (err) {
        console.error("Search failed:", err);
        setStatus("error");
        setError((err as Error).message);
      }
    }
    
    runSearch();
  }, []);

  return (
    <div style={{ padding: "20px", fontFamily: "monospace" }}>
      <h1>Simple Search Test</h1>
      <p>Status: {status}</p>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
      {result && (
        <div>
          <p>Total Found: {result.totalFound}</p>
          <p>Hits: {result.listings?.length || 0}</p>
          <p>Processing Time: {result.processingTimeMs}ms</p>
          {result.listings && result.listings.length > 0 ? (
            <ul>
              {result.listings.slice(0, 5).map((listing: any) => (
                <li key={listing.id}>
                  {listing.UnparsedAddress} - ${listing.ListPrice?.toLocaleString()}
                </li>
              ))}
            </ul>
          ) : (
            <p>No listings in result</p>
          )}
        </div>
      )}
    </div>
  );
}