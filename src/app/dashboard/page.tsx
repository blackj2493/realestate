"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Building2,
  Heart,
  Search,
  TrendingUp,
  Bell,
  Settings,
  LogOut,
  ChevronRight,
  Bed,
  Bath,
  Square,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";

// Sample saved properties
const savedProperties = [
  {
    id: "1",
    address: "123 Yonge Street, Toronto",
    price: 1250000,
    propertyType: "Condo",
    bedrooms: 2,
    bathrooms: 2,
    squareFeet: 1200,
    photoUrls: ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=400"],
    daysOnMarket: 12,
  },
  {
    id: "2",
    address: "456 King Street West, Toronto",
    price: 2100000,
    propertyType: "Townhouse",
    bedrooms: 3,
    bathrooms: 3,
    squareFeet: 1800,
    photoUrls: ["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=400"],
    daysOnMarket: 8,
  },
];

const recentSearches = [
  { query: "Toronto Condos", date: "2024-01-15" },
  { query: "Downtown core under $1.5M", date: "2024-01-14" },
  { query: "3 bedroom houses North York", date: "2024-01-12" },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("saved");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <Building2 className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold">PureProperty</span>
            </Link>
            <nav className="hidden md:flex items-center gap-6">
              <Link href="/properties" className="text-sm font-medium hover:text-primary">
                Buy
              </Link>
              <Link href="/properties?type=rent" className="text-sm font-medium hover:text-primary">
                Rent
              </Link>
              <Link href="/analytics" className="text-sm font-medium hover:text-primary">
                Market Analytics
              </Link>
              <Link href="/neighborhoods" className="text-sm font-medium hover:text-primary">
                Neighborhoods
              </Link>
            </nav>
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon">
                <Bell className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon">
                <Settings className="h-5 w-5" />
              </Button>
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-medium text-sm">JD</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Welcome, John</h1>
          <p className="text-muted-foreground mt-1">
            Track your saved properties and market insights
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Heart className="h-8 w-8 text-red-500" />
                <div>
                  <p className="text-2xl font-bold">{savedProperties.length}</p>
                  <p className="text-sm text-muted-foreground">Saved Properties</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Search className="h-8 w-8 text-blue-500" />
                <div>
                  <p className="text-2xl font-bold">{recentSearches.length}</p>
                  <p className="text-sm text-muted-foreground">Recent Searches</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-green-500" />
                <div>
                  <p className="text-2xl font-bold">5</p>
                  <p className="text-sm text-muted-foreground">Price Alerts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Bell className="h-8 w-8 text-amber-500" />
                <div>
                  <p className="text-2xl font-bold">2</p>
                  <p className="text-sm text-muted-foreground">New Listings</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 border-b mb-6">
          <button
            onClick={() => setActiveTab("saved")}
            className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "saved"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Saved Properties
          </button>
          <button
            onClick={() => setActiveTab("searches")}
            className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "searches"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Recent Searches
          </button>
          <button
            onClick={() => setActiveTab("alerts")}
            className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "alerts"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Price Alerts
          </button>
        </div>

        {/* Content */}
        {activeTab === "saved" && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {savedProperties.map((property) => (
              <Card key={property.id} className="overflow-hidden">
                <div className="relative aspect-[4/3]">
                  <Image
                    src={property.photoUrls[0]}
                    alt={property.address}
                    fill
                    className="object-cover"
                  />
                  <button className="absolute top-3 right-3 p-2 rounded-full bg-white/90 hover:bg-white">
                    <Heart className="h-5 w-5 fill-red-500 text-red-500" />
                  </button>
                </div>
                <CardContent className="p-4">
                  <div className="text-xl font-bold text-primary mb-1">
                    {formatPrice(property.price)}
                  </div>
                  <h3 className="font-semibold mb-2">{property.address}</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {property.propertyType}
                  </p>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Bed className="h-4 w-4" />
                      <span>{property.bedrooms}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Bath className="h-4 w-4" />
                      <span>{property.bathrooms}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Square className="h-4 w-4" />
                      <span>{property.squareFeet} sqft</span>
                    </div>
                  </div>
                  <Link href={`/properties/${property.id}`}>
                    <Button variant="outline" className="w-full mt-4">
                      View Details
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
            <Link href="/properties">
              <Card className="border-dashed hover:bg-muted/50 transition-colors">
                <CardContent className="p-8 flex flex-col items-center justify-center h-full min-h-[300px]">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Search className="h-6 w-6 text-primary" />
                  </div>
                  <p className="font-medium">Browse More Properties</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Explore new listings
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        )}

        {activeTab === "searches" && (
          <div className="space-y-4">
            {recentSearches.map((search, index) => (
              <Card key={index}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{search.query}</p>
                      <p className="text-sm text-muted-foreground">
                        Searched on {search.date}
                      </p>
                    </div>
                  </div>
                  <Link href={`/properties?q=${encodeURIComponent(search.query)}`}>
                    <Button variant="ghost" size="sm">
                      Repeat Search
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {activeTab === "alerts" && (
          <div className="text-center py-12">
            <Bell className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No price alerts set up yet</p>
            <Link href="/properties">
              <Button className="mt-4">Set Up Price Alert</Button>
            </Link>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="py-8 border-t mt-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} PureProperty. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
