import { NextRequest, NextResponse } from "next/server";
import { createVowClient } from "@/lib/proptx/client";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const city = searchParams.get("city") || "";
    const type = searchParams.get("type") || "buy"; // "buy" or "rent"
    const page = searchParams.get("page") || "1";
    const limit = searchParams.get("limit") || "50";

    // Get token from environment (IDX with VOW fallback)
    const token = process.env.PROPTX_IDX_TOKEN || process.env.PROPTX_VOW_TOKEN;
    
    if (!token) {
      return NextResponse.json(
        { error: "API token not configured" },
        { status: 500 }
      );
    }

    const client = createVowClient(token);
    
    // Determine transaction type based on search type
    const transactionType = type === "rent" ? "For Lease" : "For Sale";
    
    // Build filter conditions
    const conditions: string[] = [
      `TransactionType eq '${transactionType}'`,
      "StandardStatus eq 'Active'"
    ];
    
    // Add city filter if provided
    if (city) {
      conditions.unshift(`contains(City,'${city}')`);
    }
    
    const filter = conditions.join(" and ");
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build URL with raw query string to avoid double-encoding
    const baseUrl = process.env.AMPRE_API_URL || "https://query.ampre.ca/odata";
    const queryString = [
      `$filter=${encodeURIComponent(filter)}`,
      `$top=${limit}`,
      `$skip=${skip.toString()}`,
      `$orderby=ListingContractDate desc`,
      `$count=true`
    ].join("&");
    
    const apiUrl = `${baseUrl}/Property?${queryString}`;
    
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Error:", response.status, errorText);
      return NextResponse.json(
        { error: `API Error: ${response.status}` },
        { status: response.status }
      );
    }
    
    const data = await response.json();
    
    // Transform properties for display
    const properties = (data.value || []).map((p: any) => ({
      id: p.ListingKey,
      listingId: p.ListingKey,
      address: `${p.StreetNumber || ""} ${p.StreetName || ""}`.trim(),
      city: p.City || "Unknown",
      province: p.StateOrProvince || "ON",
      postalCode: p.PostalCode || "",
      price: p.ListPrice || 0,
      propertyType: p.PropertyType || "Residential",
      bedrooms: p.BedroomsTotal || 0,
      bathrooms: p.BathroomsTotalInteger || 0,
      squareFeet: p.LotSizeDimensions || 0,
      photoUrls: ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800"],
      brokerage: p.ListOfficeName || "Unknown Brokerage",
      daysOnMarket: Math.floor(
        (Date.now() -
          new Date(p.ListingContractDate || Date.now()).getTime()) /
          (1000 * 60 * 60 * 24)
      ),
    }));
    
    return NextResponse.json({
      properties,
      total: data["@odata.count"] || properties.length,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error("Error fetching properties:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
