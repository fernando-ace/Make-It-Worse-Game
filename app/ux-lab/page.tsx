import { notFound } from "next/navigation";
import UxLab from "@/components/ux-lab";

export const dynamic = "force-dynamic";

export default async function UxLabPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { state } = await searchParams;
  return <UxLab initialState={state} />;
}
