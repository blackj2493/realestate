"use client";

import { useEffect } from "react";
import { recordView } from "@/lib/dashboard/recentlyViewed";

interface RecordViewProps {
  id: string;
  address: string;
  price: number;
  thumb?: string;
  city?: string;
  brokerage?: string;
}

/** Side-effect-only: records this listing into the dashboard's recently-viewed rail. */
export default function RecordView({ id, address, price, thumb, city, brokerage }: RecordViewProps) {
  useEffect(() => {
    recordView({ id, address, price, thumb, city, brokerage });
  }, [id, address, price, thumb, city, brokerage]);

  return null;
}
