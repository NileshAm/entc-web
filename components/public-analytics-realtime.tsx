"use client";

import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function PublicAnalyticsRealtime() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("bidding:public")
      .on("broadcast", { event: "company_changed" }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 250);
      })
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <span
      className={`realtime-state public-realtime-state ${connected ? "connected" : ""}`}
      title={connected ? "Public bidding statistics are live" : "Connecting to public statistics"}
      aria-live="polite"
    >
      <Radio size={15} /> {connected ? "Live updates connected" : "Connecting to live updates"}
    </span>
  );
}
