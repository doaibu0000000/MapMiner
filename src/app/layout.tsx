import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KlienFlow — Google Maps Scraper",
  description:
    "Ambil SEMUA data bisnis dari Google Maps (nama, alamat, telepon, rating, jam buka) berdasarkan kata kunci & kota, lalu ekspor ke Excel/CSV.",
  keywords: [
    "Google Maps Scraper",
    "scrape Google Maps",
    "data bisnis Indonesia",
    "ekspor Excel",
    "lead generation",
  ],
  authors: [{ name: "KlienFlow" }],
  icons: {
    icon: "/logo.svg?v=2",
  },
  openGraph: {
    title: "KlienFlow — Google Maps Scraper",
    description: "Ambil semua data bisnis dari Google Maps, ekspor ke Excel/CSV.",
    siteName: "KlienFlow",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* pulihkan tab terakhir SEBELUM render pertama — cegah kedipan pindah tab saat reload */}
        <script
          dangerouslySetInnerHTML={{
            __html: 'try{var t=localStorage.getItem("mapminer_tab");if(t==="prospek"||t==="penawaran")document.documentElement.setAttribute("data-mm-tab",t)}catch(e){}',
          }}
        />
        {/* default gelap; enableSystem=false agar tema OS tidak menimpa;
            storageKey baru: preferensi "light" lama (kunci "theme") diabaikan —
            klik ikon tema tetap menyimpan pilihan user ke kunci baru */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="mapminer-theme">
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
