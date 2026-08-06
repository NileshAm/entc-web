"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { finishExpiredCommitteeBidding } from "@/app/actions";
import { Countdown } from "@/components/countdown";
import { formatDateTime } from "@/lib/business";

export function ManualRoundTimer({
  companyId,
  deadline,
}: {
  companyId: string;
  deadline: string;
}) {
  const router = useRouter();
  const attempted = useRef(false);
  const [isFinishing, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let retryTimer: number | undefined;
    const finishRound = () => {
      if (attempted.current) return;
      attempted.current = true;
      startTransition(async () => {
        const result = await finishExpiredCommitteeBidding(companyId);
        if (disposed) return;
        if (!result.ok) {
          attempted.current = false;
          setError(result.message);
          if (retries < 3) {
            retries += 1;
            retryTimer = window.setTimeout(finishRound, 2_000);
          } else {
            router.refresh();
          }
          return;
        }
        router.replace(`/admin?results=${companyId}#manual-results`);
      });
    };

    const delay = Math.max(0, new Date(deadline).getTime() - Date.now() + 500);
    const timer = window.setTimeout(finishRound, delay);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [companyId, deadline, router]);

  return (
    <div className="response-window-timer" aria-live="polite">
      <small>BIDDING ENDS IN</small>
      <strong><Countdown deadline={deadline} /></strong>
      <small>{isFinishing ? "Selecting students…" : formatDateTime(deadline)}</small>
      {error && <small className="danger-text">{error}</small>}
    </div>
  );
}
