"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Overview" },
  { href: "/calendar", label: "Calendar" },
  { href: "/orders", label: "Orders" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <span className="font-semibold tracking-tight">⛴ Charon</span>
        <div className="flex gap-4 text-sm">
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
