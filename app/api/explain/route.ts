import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface Body {
  persona?: string;
  facts?: string[];
}

export async function POST(req: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ text: null });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ text: null });
  }

  const facts = (body.facts ?? []).slice(0, 12);
  const model = process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";

  const prompt =
    `You are Rhythm, a warm, concise personal transit agent for ${body.persona ?? "the user"} in Boston. ` +
    `Write a day briefing of at most 3 sentences, warm and practical, using the exact times and places from these plan facts. ` +
    `Speak in the first person ("I moved...", "take the..."). Do not invent details.\n\nFacts:\n` +
    facts.map((f) => `- ${f}`).join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 220,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return NextResponse.json({ text: null });
    const json = await res.json();
    const text: string | null =
      json?.content?.[0]?.text?.trim?.() ?? null;
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ text: null });
  }
}
