import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Complaint Management", template: "%s · Complaint Management" }, description: "Receive, route, resolve and learn from complaints." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Karla:wght@400;500;700&display=swap" /></head>
      <body>{children}</body>
    </html>
  );
}
