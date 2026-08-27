import "server-only";

import { cookies } from "next/headers";
import { mapSaleorAuthErrors } from "./auth-api-utils";
import type { AuthApiError } from "./auth-api-types";
import { getServerAuthClient } from "./server";
import { ACCESS_TOKEN_MAX_AGE, REFRESH_TOKEN_MAX_AGE } from "./constants";
import { createCookieTokenStorage } from "./cookie-token-storage";
import { invariant } from "ts-invariant";

const saleorApiUrl = process.env.NEXT_PUBLIC_SALEOR_API_URL;

export type { AuthApiError };

/** Sign in via Saleor and persist tokens in request cookies (BFF). */
export async function signInWithPassword(
	email: string,
	password: string,
): Promise<{ ok: true } | { ok: false; errors: AuthApiError[] }> {
	const authClient = await getServerAuthClient();
	const result = await authClient.signIn({ email, password });
	const tokenCreate = result.data?.tokenCreate;

	if (tokenCreate?.errors?.length) {
		return { ok: false, errors: mapSaleorAuthErrors(tokenCreate.errors, "Sign in failed") };
	}

	if (tokenCreate?.token) {
		return { ok: true };
	}

	return { ok: false, errors: [{ message: "Sign in failed" }] };
}

/** Request OTP dispatch via Udaya SMS Gateway. */
export async function requestOtpCode(
	phone: string,
): Promise<{ ok: true } | { ok: false; errors: AuthApiError[] }> {
	invariant(saleorApiUrl, "Missing NEXT_PUBLIC_SALEOR_API_URL env variable");

	const query = `
		mutation OTPRequest($phone: String!) {
			otpRequest(phone: $phone) {
				success
				errors {
					field
					message
				}
			}
		}
	`;

	try {
		const response = await fetch(saleorApiUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				variables: { phone },
			}),
		});

		const result = (await response.json()) as any;
		
		if (result.errors?.length) {
			return { ok: false, errors: result.errors };
		}
		
		const otpRequest = result.data?.otpRequest;
		if (otpRequest?.errors?.length) {
			return { ok: false, errors: mapSaleorAuthErrors(otpRequest.errors, "Failed to send OTP") };
		}

		if (otpRequest?.success) {
			return { ok: true };
		}

		return { ok: false, errors: [{ message: "Failed to send OTP" }] };
	} catch (err: any) {
		return { ok: false, errors: [{ message: err.message || "Failed to request OTP" }] };
	}
}

/** Confirm OTP and write JWT access/refresh tokens to secure HTTP cookies. */
export async function signInWithOtp(
	phone: string,
	otp: string,
): Promise<{ ok: true } | { ok: false; errors: AuthApiError[] }> {
	invariant(saleorApiUrl, "Missing NEXT_PUBLIC_SALEOR_API_URL env variable");

	const query = `
		mutation OTPConfirm($phone: String!, $otp: String!) {
			otpConfirm(phone: $phone, otp: $otp) {
				token
				refreshToken
				errors {
					field
					message
				}
			}
		}
	`;

	try {
		const response = await fetch(saleorApiUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query,
				variables: { phone, otp },
			}),
		});

		const result = (await response.json()) as any;
		
		if (result.errors?.length) {
			return { ok: false, errors: result.errors };
		}

		const otpConfirm = result.data?.otpConfirm;
		if (otpConfirm?.errors?.length) {
			return { ok: false, errors: mapSaleorAuthErrors(otpConfirm.errors, "OTP verification failed") };
		}

		const token = otpConfirm?.token;
		const refreshToken = otpConfirm?.refreshToken;

		if (!token || !refreshToken) {
			return { ok: false, errors: [{ message: "Invalid OTP code" }] };
		}

		// Save the tokens in cookies using the standard CookieTokenStorage
		const cookieStore = await cookies();
		const storage = createCookieTokenStorage(cookieStore, saleorApiUrl, {
			secure: process.env.NODE_ENV === "production",
			accessTokenMaxAge: ACCESS_TOKEN_MAX_AGE,
			refreshTokenMaxAge: REFRESH_TOKEN_MAX_AGE,
		});

		storage.setItem(`${saleorApiUrl}+saleor_auth_access_token`, token);
		storage.setItem(`${saleorApiUrl}+saleor_auth_refresh_token`, refreshToken);

		return { ok: true };
	} catch (err: any) {
		return { ok: false, errors: [{ message: err.message || "Failed to confirm OTP" }] };
	}
}

/** Complete password reset and establish a session (BFF). */
export async function resetPasswordWithToken(
	email: string,
	token: string,
	password: string,
): Promise<{ ok: true } | { ok: false; errors: AuthApiError[] }> {
	const authClient = await getServerAuthClient();
	const result = await authClient.resetPassword({ email, token, password });
	const setPassword = result.data?.setPassword;

	if (setPassword?.errors?.length) {
		return { ok: false, errors: mapSaleorAuthErrors(setPassword.errors, "Failed to reset password") };
	}

	if (setPassword?.token) {
		return { ok: true };
	}

	return { ok: false, errors: [{ message: "Failed to reset password" }] };
}

/** Clear Saleor auth cookies for the current session. */
export async function signOutSession(): Promise<void> {
	(await getServerAuthClient()).signOut();
}
