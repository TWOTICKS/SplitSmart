"use client";

import { useState } from "react";

export function InviteCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/join/${code}` : `/join/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — the code is still visible to copy by hand
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <span className="text-sm font-medium">Invite code</span>
      <span className="text-2xl font-semibold tracking-widest">{code}</span>
      <button
        type="button"
        onClick={copy}
        className="mt-1 h-10 rounded-lg border border-zinc-300 text-sm font-medium dark:border-zinc-700"
      >
        {copied ? "Link copied" : "Copy invite link"}
      </button>
    </div>
  );
}
