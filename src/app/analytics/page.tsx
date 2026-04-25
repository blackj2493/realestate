"use client";

import { useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Building2,
  TrendingUp,
  TrendingDown,
  Calendar,
  MapPin,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice } from "@/lib/utils";

// Sample market data
const priceTrendsData = [
  { month: "Jan", avgPrice: 1050000, listings: 245 },
  { month: "Feb", avgPrice: 1080000, listings: 268 },
  { month: "Mar", avgPrice: 1120000, listings: 312 },
  { month: "Apr", avgPrice: 1150000, listings: 298 },
  { month: "May", avgPrice: 1180000, listings: 345 },
  { month: "Jun", avgPrice: 1210000, listings: 378 },
  { month: "Jul", avgPrice: 1195000, listings: 356 },
  { month: "Aug", avgPrice: 1220000, listings: 389 },
  { month: "Sep", avgPrice: 1250000, listings: 412 },
  { month: "Oct", avgPrice: 1230000, listings: 398 },
  { month: "Nov", avgPrice: 1260000, listings: 356 },
  { month: "Dec", avgPrice: 1285000, listings: 312 },
];

const marketConditionsData = [
  { name: "Seller's Market", value: 35, color: "#22c55e" },
  { name: "Balanced Market", value: 40, color: "#eab308" },
  { name: "Buyer's Market", value: 25, color: "#ef4444" },
];

const propertyTypeData = [
  { type: "Condo", avgPrice: 720000, trend: 5.2 },
  { type: "Townhouse", avgPrice: 950000, trend: 3.8 },
  { type: "Semi-Detached", avgPrice: 1150000, trend: 4.5 },
  { type: "Detached", avgPrice: 1650000, trend: 6.1 },
  { type: "Commercial", avgPrice: 2800000, trend: -1.2 },
];

const topNeighborhoods = [
  { name: "Downtown Core", avgPrice: 1450000, listings: 156, trend: 8.2 },
  { name: "Midtown", avgPrice: 1280000, listings: 89, trend: 5.6 },
  { name: "North York", avgPrice: 1150000, listings: 234, trend: 4.1 },
  { name: "Scarborough", avgPrice: 980000, listings: 178, trend: 3.5 },
  { name: "Etobicoke", avgPrice: 1050000, listings: 145, trend: 4.8 },
  { name: "Markham", avgPrice: 1320000, listings: 112, trend: 6.2 },
];

const daysOnMarketData = [
  { month: "Jan", avgDOM: 28 },
  { month: "Feb", avgDOM: 25 },
  { month: "Mar", avgDOM: 22 },
  { month: "Apr", avgDOM: 18 },
  { month: "May", avgDOM: 15 },
  { month: "Jun", avgDOM: 14 },
  { month: "Jul", avgDOM: 16 },
  { month: "Aug", avgDOM: 17 },
  { month: "Sep", avgDOM: 19 },
  { month: "Oct", avgDOM: 21 },
  { month: "Nov", avgDOM: 24 },
  { month: "Dec", avgDOM: 27 },
];

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState("1y");
  const [propertyType, setPropertyType] = useState("all");

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
              <Link href="/analytics" className="text-sm font-medium text-primary">
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

      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Market Analytics</h1>
            <p className="text-muted-foreground mt-2">
              Real-time insights and trends for the Toronto real estate market
            </p>
          </div>
          <div className="flex gap-2">
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Time Range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3m">Last 3 Months</SelectItem>
                <SelectItem value="6m">Last 6 Months</SelectItem>
                <SelectItem value="1y">Last Year</SelectItem>
                <SelectItem value="2y">Last 2 Years</SelectItem>
                <SelectItem value="5y">Last 5 Years</SelectItem>
              </SelectContent>
            </Select>
            <Select value={propertyType} onValueChange={setPropertyType}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Property Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="house">House</SelectItem>
                <SelectItem value="condo">Condo</SelectItem>
                <SelectItem value="townhouse">Townhouse</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Key Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-primary" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Average Price</p>
              <p className="text-2xl font-bold mt-1">{formatPrice(1285000)}</p>
              <p className="text-sm text-green-600 flex items-center gap-1 mt-1">
                <TrendingUp className="h-3 w-3" />
                +12.5% YoY
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-blue-500" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Avg Days on Market</p>
              <p className="text-2xl font-bold mt-1">19</p>
              <p className="text-sm text-green-600 flex items-center gap-1 mt-1">
                <TrendingDown className="h-3 w-3" />
                -8.2% vs last year
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-purple-500" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Active Listings</p>
              <p className="text-2xl font-bold mt-1">3,456</p>
              <p className="text-sm text-amber-600 flex items-center gap-1 mt-1">
                <TrendingUp className="h-3 w-3" />
                +5.2% MoM
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <MapPin className="h-5 w-5 text-amber-500" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Sale to List Ratio</p>
              <p className="text-2xl font-bold mt-1">98.5%</p>
              <p className="text-sm text-green-600 flex items-center gap-1 mt-1">
                <TrendingUp className="h-3 w-3" />
                +1.2% vs last year
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 1 */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Price Trends Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LineChart className="h-5 w-5" />
                Average Sale Price Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={priceTrendsData}>
                    <defs>
                      <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis
                      tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                    />
                    <Tooltip
                      formatter={(value: number) => [formatPrice(value), "Avg Price"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="avgPrice"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorPrice)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Market Conditions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="h-5 w-5" />
                Market Conditions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={marketConditionsData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {marketConditionsData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-6 mt-4">
                {marketConditionsData.map((item) => (
                  <div key={item.name} className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm">
                      {item.name}: {item.value}%
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Days on Market Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Average Days on Market
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daysOnMarketData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="avgDOM" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Price by Property Type */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Price by Property Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={propertyTypeData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      tickFormatter={(value) => `$${(value / 1000000).toFixed(1)}M`}
                    />
                    <YAxis type="category" dataKey="type" width={100} />
                    <Tooltip
                      formatter={(value: number) => [formatPrice(value), "Avg Price"]}
                    />
                    <Bar dataKey="avgPrice" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top Neighborhoods */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Top Performing Neighborhoods
              </span>
              <Link href="/neighborhoods">
                <Button variant="ghost" size="sm">
                  View All
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                      Neighborhood
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      Avg Price
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      Active Listings
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      YoY Trend
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topNeighborhoods.map((neighborhood) => (
                    <tr key={neighborhood.name} className="border-b hover:bg-muted/50">
                      <td className="py-4 px-4 font-medium">{neighborhood.name}</td>
                      <td className="py-4 px-4 text-right">{formatPrice(neighborhood.avgPrice)}</td>
                      <td className="py-4 px-4 text-right">{neighborhood.listings}</td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-green-600 flex items-center justify-end gap-1">
                          <TrendingUp className="h-3 w-3" />
                          +{neighborhood.trend}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Disclaimer */}
      <div className="container mx-auto px-4 py-6 text-center">
        <p className="text-xs text-muted-foreground">
          Market data is deemed reliable but not guaranteed. Information provided herein must only 
          be used by consumers that have a bona fide interest in the purchase, sale, or lease of 
          real estate and may not be used for any commercial purpose.
        </p>
      </div>

      {/* Footer */}
      <footer className="py-8 border-t mt-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} PureProperty. All rights reserved. | Powered by PROPTX MLS®</p>
        </div>
      </footer>
    </div>
  );
}
