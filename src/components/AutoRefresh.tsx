"use client";
/** Re-render the page every few seconds while something is still filling in (e.g. a heat map). */
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
