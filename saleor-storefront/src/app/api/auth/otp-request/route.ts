import { NextRequest, NextResponse } from "next/server";
import { httpStatusForAuthErrors } from "@/lib/auth/auth-api-utils";
import { rejectIfRateLimited } from "@/lib/auth/auth-rate-limit";
import { requestOtpCode } from "@/lib/auth/bff-server";

interface OtpRequestPayload {
	phone: string;
}

export async function POST(request: NextRequest) {
	const rateLimited = rejectIfRateLimited(request, "login");
	if (rateLimited) {
		return rateLimited;
	}

	let body: OtpRequestPayload;
	try {
		body = (await request.json()) as OtpRequestPayload;
	} catch {
		return NextResponse.json(
			{ errors: [{ message: "Invalid request body", code: "INVALID_JSON" }] },
			{ status: 400 },
		);
	}

	const { phone } = body;

	if (!phone) {
		return NextResponse.json(
			{ errors: [{ message: "Phone number is required", code: "REQUIRED" }] },
			{ status: 400 },
		);
	}

	const result = await requestOtpCode(phone);

	if (!result.ok) {
		return NextResponse.json({ errors: result.errors }, { status: httpStatusForAuthErrors(result.errors) });
	}

	return NextResponse.json({ ok: true });
}
