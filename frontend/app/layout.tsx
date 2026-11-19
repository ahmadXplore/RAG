import type { Metadata } from "next";
import React from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Educational & Research RAG — Document Intelligence Platform",
  description: "Grounded answers over academic research papers, educational datasets, and institutional publications with verifiable citations.",
};

// Next.js / Turbopack dev mode requires eval() for React debugging features.
// unsafe-eval is included only in development; production builds omit it.
const isDev = process.env.NODE_ENV === "development";
const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://rag-production-507bfa97.up.railway.app";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Rule 7: Content-Security-Policy — allow self, Railway API, and local dev */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={`default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.railway.app https://rag-production-507bfa97.up.railway.app wss://*.railway.app http://localhost:8000 ws://localhost:8000 ${apiUrl}; img-src 'self' data: https:;`}
        />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
