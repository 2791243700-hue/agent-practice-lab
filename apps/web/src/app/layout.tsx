import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, Shell } from "@/components/ui";
import "./globals.css";
export const metadata: Metadata = {
  title: "Agent Practice Lab · Agent 入门实训室",
  description: "从零开始，在真实操作中理解 Agent。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <Shell>
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </Shell>
      </body>
    </html>
  );
}
