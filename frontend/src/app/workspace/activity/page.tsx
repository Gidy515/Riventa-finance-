import type { Metadata } from "next";
import { WorkspaceClient } from "@/components/auth/workspace-client";

export const metadata: Metadata = {
  title: "Trade activity | Riventa",
  description: "Review and manage Riventa trade activity."
};

export default function TradeActivityPage() {
  return <WorkspaceClient page="activity" />;
}
