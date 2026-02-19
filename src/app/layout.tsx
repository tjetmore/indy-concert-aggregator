import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Indiana Concerts",
  description: "Aggregated concerts for Ruoff Music Center and Everwise Amphitheater."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
