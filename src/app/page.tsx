"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  TrendingUp,
  BarChart3,
  Home,
  MapPin,
  ChevronRight,
  Building2,
  LineChart,
  PieChart,
  Navigation,
  Loader2,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyCard, type PropertyCardData } from "@/components/PropertyCard";
import { SearchDropdown } from "@/components/SearchDropdown";
import { useGeolocation, getLocationDisplay } from "@/hooks/useGeolocation";

export default function HomePage() {
  const [properties, setProperties] = useState<PropertyCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<"buy" | "rent">("buy");
  
  const geo = useGeolocation();

  // Fetch properties based on location
  useEffect(() => {
    async function fetchNearbyProperties() {
      if (geo.loading) return;
      
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: "12",
        });
        
        // Prefer postal code for more specific location, fall back to city
        if (geo.postalCode) {
          params.set("postalCode", geo.postalCode);
        } else if (geo.city) {
          params.set("city", geo.city);
        }
        
        const response = await fetch(`/api/nearby?${params.toString()}`);
        
        if (response.ok) {
          const data = await response.json();
          setProperties(data.properties || []);
        } else {
          console.error("Failed to fetch properties");
          setProperties([]);
        }
      } catch (error) {
        console.error("Error fetching properties:", error);
        setProperties([]);
      } finally {
        setLoading(false);
      }
    }

    fetchNearbyProperties();
  }, [geo.loading, geo.postalCode, geo.city]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/properties?search=${encodeURIComponent(searchQuery)}&type=${searchType}`;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
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
              <Link href="/login">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link href="/register">
                <Button>Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section with Location Detection */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5" />
        <div className="container mx-auto px-4 relative">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
              Real Estate Market
              <br />
              <span className="text-primary">Intelligence</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
              Data-driven insights for smarter property decisions. Track market trends, 
              analyze neighborhoods, and find your perfect home with confidence.
            </p>
            
            {/* Search Box */}
            <div className="bg-card rounded-xl shadow-lg border p-4 md:p-6">
              <SearchDropdown
                value={searchQuery}
                onChange={setSearchQuery}
                searchType={searchType}
                onSearchTypeChange={setSearchType}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Location Banner */}
      <section className="py-4 bg-muted/30 border-y">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                geo.loading ? "bg-primary/20" : "bg-primary/10"
              }`}>
                {geo.loading ? (
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                ) : geo.denied ? (
                  <MapPin className="h-5 w-5 text-primary" />
                ) : (
                  <Navigation className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <p className="text-sm font-medium">
                  {geo.loading ? (
                    "Detecting your location..."
                  ) : (
                    <>
                      Showing properties near <span className="text-primary font-semibold">{getLocationDisplay(geo)}</span>
                    </>
                  )}
                </p>
                {geo.error && (
                  <p className="text-xs text-muted-foreground">{geo.error}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={geo.refresh}
                disabled={geo.loading}
              >
                <MapPin className="h-4 w-4 mr-2" />
                {geo.loading ? "Detecting..." : "Change Location"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Nearby Properties Section */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium text-primary">Near You</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold">
                Properties {geo.city ? `in ${geo.city}` : "in Toronto"}
              </h2>
              <p className="text-muted-foreground mt-1">
                {loading ? "Loading..." : `${properties.length} active listings available`}
              </p>
            </div>
            <Link href="/properties">
              <Button variant="outline" className="gap-2">
                View All <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {[...Array(8)].map((_, i) => (
                <Card key={i} className="overflow-hidden">
                  <div className="aspect-[4/3] bg-muted animate-pulse" />
                  <CardContent className="p-4">
                    <div className="h-6 w-24 bg-muted animate-pulse rounded mb-2" />
                    <div className="h-4 w-full bg-muted animate-pulse rounded mb-2" />
                    <div className="h-4 w-2/3 bg-muted animate-pulse rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : properties.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {properties.slice(0, 8).map((property) => (
                <PropertyCard
                  key={property.id}
                  property={property}
                  showDistance={!!(geo.latitude && geo.longitude)}
                />
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Properties Found</h3>
              <p className="text-muted-foreground mb-4">
                We couldn't find any properties in your area. Try expanding your search.
              </p>
              <Link href="/properties">
                <Button>Browse All Properties</Button>
              </Link>
            </Card>
          )}
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 border-y bg-muted/50">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary">10K+</div>
              <div className="text-sm text-muted-foreground mt-2">Active Listings</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary">500+</div>
              <div className="text-sm text-muted-foreground mt-2">Neighborhoods</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary">50+</div>
              <div className="text-sm text-muted-foreground mt-2">Cities Covered</div>
            </div>
            <div className="text-center">
              <div className="text-3xl md:text-4xl font-bold text-primary">Real-time</div>
              <div className="text-sm text-muted-foreground mt-2">Market Data</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Powerful Market Analytics</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Make informed decisions with comprehensive real-time market data and trend analysis.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <Card className="group hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <TrendingUp className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Price Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Track historical price movements and market trends across different neighborhoods and property types.
                </p>
              </CardContent>
            </Card>

            {/* Feature 2 */}
            <Card className="group hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Market Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Access detailed statistics including average days on market, sale-to-list ratios, and price per square foot.
                </p>
              </CardContent>
            </Card>

            {/* Feature 3 */}
            <Card className="group hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Home className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Property Comparisons</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Compare similar properties in the area to understand fair market value and investment potential.
                </p>
              </CardContent>
            </Card>

            {/* Feature 4 */}
            <Card className="group hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <LineChart className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Investment Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Evaluate rental yields, cap rates, and appreciation potential for investment properties.
                </p>
              </CardContent>
            </Card>

            {/* Feature 5 */}
            <Card className="group hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <PieChart className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Market Conditions</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Understand buyer vs seller markets, inventory levels, and overall market health indicators.
                </p>
              </CardContent>
            </Card>

            {/* Feature 6 */}
            <Card className="group hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <MapPin className="h-6 w-6 text-primary" />
                </div>
                <CardTitle>Neighborhood Insights</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Explore demographics, schools, transit scores, and local amenities for any area.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to Find Your Dream Home?</h2>
          <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
            Join thousands of buyers making smarter decisions with PureProperty.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                Create Free Account
              </Button>
            </Link>
            <Link href="/properties">
              <Button size="lg" variant="outline" className="bg-transparent border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary w-full sm:w-auto">
                Browse Listings
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="h-6 w-6 text-primary" />
                <span className="text-lg font-bold">PureProperty</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Real estate market intelligence for smart property decisions.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Quick Links</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/properties" className="hover:text-primary">Browse Listings</Link></li>
                <li><Link href="/analytics" className="hover:text-primary">Market Analytics</Link></li>
                <li><Link href="/neighborhoods" className="hover:text-primary">Neighborhoods</Link></li>
                <li><Link href="/about" className="hover:text-primary">About Us</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/privacy" className="hover:text-primary">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-primary">Terms of Service</Link></li>
                <li><Link href="/disclaimer" className="hover:text-primary">Disclaimer</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Contact</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>4711 Yonge St, 10th Floor</li>
                <li>Toronto, ON</li>
                <li>info@pureproperty.ca</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
            <p>© {new Date().getFullYear()} PureProperty. All rights reserved.</p>
            <p className="mt-2 text-xs">
              The information provided herein must only be used by consumers that have a bona fide 
              interest in the purchase, sale, or lease of real estate and may not be used for any 
              commercial purpose or any other purpose.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
