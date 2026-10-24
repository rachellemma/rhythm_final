import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface Body {
  to?: string;
  subject?: string;
  body?: string;
}

export async function POST(req: Request) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return NextResponse.json({ sent: false, reason: "no-key" });
  }

  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ sent: false, reason: "bad-request" });
  }

  const to = process.env.NOTIFY_OVERRIDE_TO || payload.to;
  if (!to) {
    return NextResponse.json({ sent: false, reason: "no-recipient" });
  }

  const from = process.env.NOTIFY_FROM || "Rhythm <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: payload.subject ?? "A quick heads-up from Rhythm",
        text: payload.body ?? "",
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ sent: false, reason: `resend-${res.status}` });
    }
    return NextResponse.json({ sent: true });
  } catch {
    return NextResponse.json({ sent: false, reason: "network" });
  }
}
