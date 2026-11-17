import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { MotionProvider } from "@/components/motion";
import { db } from "@/lib/db";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Acumen",
  description: "Acumen — a five-round business and analytics challenge for college teams.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const announcement = await db.announcement.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } });
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable}`}>
      <body className="relative min-h-screen overflow-x-hidden font-sans antialiased">
        <MotionProvider>
          <Nav />
          <main className="pt-24 sm:pt-28">
            {announcement && (
              <div className="mx-auto mb-2 flex max-w-6xl justify-center px-4">
                <p className="rounded-full border border-amber-200 bg-amber-50/90 px-4 py-1.5 text-center text-xs font-medium text-amber-900 shadow-soft backdrop-blur">
                  {announcement.message}
                </p>
              </div>
            )}
            {children}
          </main>
        </MotionProvider>
      </body>
    </html>
  );
}
