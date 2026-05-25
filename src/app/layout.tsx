import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MainNav } from "@/components/MainNav";
import { CreatorCredit } from "@/components/CreatorCredit";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ระบบจัดการคลังสินค้า | Pioneer Engineering International",
  description: "ระบบจัดการคลังสินค้าและเบิกจ่ายพัสดุ — Pioneer Engineering International",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0A0A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <header className="company-header">
          <div className="company-header-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpg"
              alt="Explorar — Extreme Performance"
              className="company-logo"
            />
            <h1 className="company-name">
              บริษัท ไพโอเนียร์ เอ็นจิเนียริ่ง อินเตอร์เนชั่นแนล จำกัด
            </h1>
          </div>
        </header>
        <MainNav />
        <main className="app-main">{children}</main>
        <CreatorCredit />
      </body>
    </html>
  );
}
