import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Maestro",
  description: "AI Agent Orchestration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark h-full">
      <body className={`${geistMono.variable} font-mono antialiased bg-gray-950 text-gray-100 h-full overflow-hidden`}>
        {children}
      </body>
    </html>
  );
}
