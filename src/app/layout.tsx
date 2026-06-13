import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import WatchlistInit from "@/components/watchlist/WatchlistInit";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PureProperty - Real Estate Market Analytics",
  description: "Find your dream home with advanced market analytics and real-time MLS listings.",
};

// Mobile viewport: device-width + viewport-fit=cover so safe-area-inset env()
// vars resolve on notched phones; dark theme-color so the browser chrome matches
// the app instead of flashing white. Pinch-zoom left enabled on purpose (a11y).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A1828",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className={`${inter.className} min-h-app bg-background text-foreground`}>
        <WatchlistInit />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
