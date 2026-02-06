import { NextResponse } from "next/server";
import { AppError, isAppError, toErrorPayload } from "@/lib/errors";

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function jsonError(error: unknown) {
  if (isAppError(error)) {
    return NextResponse.json(toErrorPayload(error), { status: error.statusCode });
  }

  return NextResponse.json(toErrorPayload(error), { status: 500 });
}

export function ensure(condition: unknown, message: string, statusCode = 400, code = "BAD_REQUEST") {
  if (!condition) {
    throw new AppError(message, statusCode, code);
  }
}
