import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.json({ message: `OAuth retornou erro: ${error}` }, { status: 400 });
  }

  return NextResponse.json({
    message:
      "Callback recebido. Use o code para trocar por refresh token no fluxo OAuth externo (OAuth Playground/script).",
    code
  });
}
