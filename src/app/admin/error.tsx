"use client";

import { Alert, cls } from "@/components/ui";

export default function AdminError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-4">
      <Alert tone="red">{error.message || "Something went wrong."}</Alert>
      <button onClick={reset} className={`${cls.btn} ${cls.secondary}`}>Try again</button>
    </div>
  );
}
