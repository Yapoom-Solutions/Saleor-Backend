import { NextRequest, NextResponse } from "next/server";
import { httpStatusForAuthErrors } from "@/lib/auth/auth-api-utils";
import { rejectIfRateLimited } from "@/lib/auth/auth-rate-limit";
import { signInWithOtp } from "@/lib/auth/bff-server";

interface OtpConfirmPayload {
	phone: string;
	otp: string;
}

export async function POST(request: NextRequest) {
	const rateLimited = rejectIfRateLimited(request, "login");
	if (rateLimited) {
		return rateLimited;
	}

	let body: OtpConfirmPayload;
	try {
		body = (await request.json()) as OtpConfirmPayload;
	} catch {
		return NextResponse.json(
			{ errors: [{ message: "Invalid request body", code: "INVALID_JSON" }] },
			{ status: 400 },
		);
	}

	const { phone, otp } = body;

	if (!phone || !otp) {
		return NextResponse.json(
			{ errors: [{ message: "Phone and OTP code are required", code: "REQUIRED" }] },
			{ status: 400 },
		);
	}

	const result = await signInWithOtp(phone, otp);

	if (!result.ok) {
		return NextResponse.json({ errors: result.errors }, { status: httpStatusForAuthErrors(result.errors) });
	}

	return NextResponse.json({ ok: true });
}
