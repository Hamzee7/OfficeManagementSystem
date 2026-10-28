import { NextResponse } from "next/server";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    getDb().prepare("SELECT 1").get();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
