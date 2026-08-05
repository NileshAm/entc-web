"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function RealtimeRefresh({ userId }: { userId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.realtime.setAuth();
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };
    const liveChannel = supabase
      .channel("bidding:live", { config: { private: true } })
      .on("broadcast", { event: "company_changed" }, refresh)
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));
    const userChannel = supabase
      .channel(`student:${userId}`, { config: { private: true } })
      .on("broadcast", { event: "notification_created" }, refresh)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(liveChannel);
      void supabase.removeChannel(userChannel);
    };
  }, [router, userId]);

  return (
    <span className={`realtime-state ${connected ? "connected" : ""}`} title={connected ? "Realtime connected" : "Connecting to realtime"}>
      <Radio size={14} /> <span>{connected ? "Live" : "Connecting"}</span>
    </span>
  );
}
