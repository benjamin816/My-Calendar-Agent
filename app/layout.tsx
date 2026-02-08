// Add missing React import to fix namespace and children type errors
import React from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Chronos AI - Smart Calendar Assistant",
  description: "Intelligent calendar and task management agent.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/**
 * Root Layout component for the application.
 * Fixes Property 'children' missing error on line 35 by using standard prop types 
 * and passing children as an explicit prop to the Providers component.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-50 text-slate-900 antialiased`}>
        {/* 
          Fixes Error: Property 'children' is missing in type '{}' but required in type '{ children: React.ReactNode; }'
          By explicitly passing children as a prop, we ensure the TypeScript compiler correctly identifies the prop usage.
        */}
        <Providers children={children} />
      </body>
    </html>
  );
}
