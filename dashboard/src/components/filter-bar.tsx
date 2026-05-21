"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

const MODES = [
  { v: "both", label: "All" },
  { v: "dry_run", label: "Dry run" },
  { v: "live", label: "Live" },
];

export function FilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const mode = params.get("mode") ?? "both";
  const lastN = params.get("lastN") ?? "";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">From</span>
        <Input type="date" value={from} onChange={(e) => update({ from: e.target.value, lastN: null })} className="w-[150px]" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">To</span>
        <Input type="date" value={to} onChange={(e) => update({ to: e.target.value, lastN: null })} className="w-[150px]" />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Last N</span>
        <Input
          type="number" min={1} value={lastN} placeholder="—"
          onChange={(e) => update({ lastN: e.target.value, from: null, to: null })}
          className="w-[100px]"
        />
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm">Mode: {MODES.find((m) => m.v === mode)?.label}</Button>} />
        <DropdownMenuContent>
          {MODES.map((m) => (
            <DropdownMenuItem key={m.v} onSelect={() => update({ mode: m.v === "both" ? null : m.v })}>
              {m.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" onClick={() => update({ from: null, to: null, lastN: null, mode: null, strategy: null })}>
        Reset
      </Button>
      {pending && <span className="text-muted-foreground">…</span>}
    </div>
  );
}
