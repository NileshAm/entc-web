"use client";

import { useEffect, useState } from "react";

export function Countdown({ deadline }: { deadline: string }) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    const update = () => {
      const milliseconds = Math.max(0, new Date(deadline).getTime() - Date.now());
      const minutes = Math.floor(milliseconds / 60000);
      const seconds = Math.floor((milliseconds % 60000) / 1000);
      setRemaining(milliseconds === 0 ? "Expired" : `${minutes}:${seconds.toString().padStart(2, "0")}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [deadline]);

  return <time dateTime={deadline}>{remaining || "—"}</time>;
}
