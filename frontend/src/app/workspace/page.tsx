import type { Metadata } from "next";
import { WorkspaceClient } from "@/components/auth/workspace-client";

export const metadata: Metadata = {
  title: "Workspace | Riventa",
  description: "Authenticated Riventa trade operations workspace."
};

export default function WorkspacePage() {
  return <WorkspaceClient />;
}
