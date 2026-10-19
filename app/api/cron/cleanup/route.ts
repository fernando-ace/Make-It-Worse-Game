import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/server";
import { getEnvironmentSafety } from "@/lib/environment-safety.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!getEnvironmentSafety().runtimeMutationAllowed)
    return NextResponse.json({ error: "Cleanup target is not an approved backend for this deployment." }, { status: 503 });
  try {
    const { data, error } = await admin().rpc("cr_cleanup_expired_data");
    if (error) throw error;
    return NextResponse.json({ ok: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Cleanup failed." }, { status: 500 });
  }
}
