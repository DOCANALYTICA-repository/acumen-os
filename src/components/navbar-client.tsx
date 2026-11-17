"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/actions/auth";
import { AcumenMark } from "./logo";

type Item = { href: string; label: string };

export function NavbarClient({ role }: { role: string | null }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [pathname]);

  const items: Item[] = [
    { href: "/", label: "Home" },
    { href: "/#rounds", label: "Rounds" },
    { href: "/#faq", label: "FAQ" },
    ...(role === "PARTICIPANT" ? [{ href: "/dashboard", label: "Dashboard" }] : []),
    ...(role === "JUDGE" ? [{ href: "/judge", label: "Judging" }] : []),
    ...(role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  const isActive = (href: string) => (href === "/" ? pathname === "/" : !href.includes("#") && pathname.startsWith(href));

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <motion.nav
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`pointer-events-auto flex w-full max-w-6xl items-center justify-between rounded-full px-3 py-2 transition-all duration-300 ${
          scrolled ? "border border-white/70 bg-white/75 shadow-glass backdrop-blur-2xl" : "border border-white/50 bg-white/45 shadow-soft backdrop-blur-xl"
        }`}
      >
        <Link href="/" className="flex items-center gap-2 pl-1 transition-transform duration-300 hover:scale-105" aria-label="Acumen home">
          <AcumenMark className="h-9 w-9" />
          <span className="text-base font-bold tracking-tight text-ink">Acumen</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className="relative rounded-full px-3.5 py-1.5 text-sm font-medium text-ink/70 transition-colors hover:text-ink">
              {isActive(item.href) && (
                <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-white/90 shadow-soft ring-1 ring-sky-100" transition={{ type: "spring", stiffness: 380, damping: 30 }} />
              )}
              <span className={`relative z-10 ${isActive(item.href) ? "text-sky-700" : ""}`}>{item.label}</span>
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {role ? (
            <form action={logout}>
              <button className="rounded-full px-4 py-2 text-sm font-medium text-ink/70 hover:text-ink">Log out</button>
            </form>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-4 py-2 text-sm font-medium text-ink/70 hover:text-ink">Log in</Link>
              <Link href="/register" className="btn-primary px-5 py-2">Register</Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-full border border-white/60 bg-white/60 text-ink backdrop-blur md:hidden"
          aria-label="Toggle navigation"
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </motion.nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-auto absolute top-20 w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-white/70 bg-white/90 p-3 shadow-glass-lg backdrop-blur-2xl md:hidden"
          >
            <div className="grid gap-1">
              {items.map((item) => (
                <Link key={item.href} href={item.href} className={`rounded-2xl px-4 py-3 text-sm font-medium ${isActive(item.href) ? "bg-sky-50 text-sky-700" : "text-ink/80 hover:bg-white"}`}>
                  {item.label}
                </Link>
              ))}
              {role ? (
                <form action={logout}><button className="w-full rounded-2xl px-4 py-3 text-left text-sm font-medium text-ink/80 hover:bg-white">Log out</button></form>
              ) : (
                <>
                  <Link href="/login" className="rounded-2xl px-4 py-3 text-sm font-medium text-ink/80 hover:bg-white">Log in</Link>
                  <Link href="/register" className="btn-primary mt-1">Register</Link>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
