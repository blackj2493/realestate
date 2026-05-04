"use client";

import { useState, useEffect } from "react";

export default function DebugPage() {
  const [serverResult, setServerResult] = useState<any>(null);
  const [clientResult, setClientResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

    // Test server-side API call
  useEffect(() => {
    async function testServerAPI() {
      const resp = await fetch('/api/debug-search');
      const data = await resp.json();
      setServerResult(data);
      console.log('[DebugPage] Server result:', data);
    }
    testServerAPI();
  }, []);

  // Test client-side Typesense import
  async function testClientTypesense() {
    setLoading(true);
    try {
      const { searchListings } = await import('@/lib/typesense/client');
      const result = await searchListings({
        query: '*',
        filters: { transactionType: "For Sale" },
        page: 1,
        perPage: 5
      });
      setClientResult(result);
    } catch (err) {
      setClientResult({ error: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Debug: Typesense Search Results</h1>
      
      <div className="grid grid-cols-2 gap-8">
        {/* Server-side API test */}
        <div className="p-4 border rounded bg-slate-800">
          <h2 className="text-lg font-semibold mb-2">Server-side API (/api/debug-search)</h2>
          {serverResult ? (
            <pre className="text-sm bg-slate-900 p-2 rounded overflow-auto max-h-96">
              {JSON.stringify(serverResult, null, 2)}
            </pre>
          ) : (
            <p>Loading...</p>
          )}
        </div>

        {/* Client-side Typesense test */}
        <div className="p-4 border rounded bg-slate-800">
          <h2 className="text-lg font-semibold mb-2">Client-side searchListings()</h2>
          <button 
            onClick={testClientTypesense}
            disabled={loading}
            className="mb-2 px-4 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
          >
            {loading ? "Testing..." : "Test Client Search"}
          </button>
          {clientResult && (
            <pre className="text-sm bg-slate-900 p-2 rounded overflow-auto max-h-96">
              {JSON.stringify(clientResult, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {/* Test if frontend page gets results */}
      <div className="mt-8 p-4 border rounded bg-slate-800">
        <h2 className="text-lg font-semibold mb-2">Frontend Page Test</h2>
        <a href="/properties" className="text-emerald-400 hover:underline">
          Go to /properties page and check browser console
        </a>
      </div>
    </div>
  );
}