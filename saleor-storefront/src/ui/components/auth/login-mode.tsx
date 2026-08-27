"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Phone, Shield, Pencil } from "lucide-react";
import { requestOtpWithBff, verifyOtpWithBff, syncAuthSurfacesAfterSignIn } from "@/lib/auth";
import { buildStorefrontPath } from "@/lib/storefront-path";
import { Button } from "@/ui/components/ui/button";
import { Input } from "@/ui/components/ui/input";
import { Label } from "@/ui/components/ui/label";

export function LoginMode() {
	const params = useParams<{ locale: string; channel: string }>();
	const router = useRouter();

	const [phone, setPhone] = useState("");
	const [otp, setOtp] = useState("");
	const [step, setStep] = useState<1 | 2>(1);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [successMessage, setSuccessMessage] = useState("");

	const handleSendOtp = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setSuccessMessage("");

		// Simple validation: Ensure phone number starts with + and has enough digits
		if (!phone || !phone.startsWith("+") || phone.length < 10) {
			setError("Please enter a valid phone number including country code (e.g. +919944758128)");
			return;
		}

		setIsSubmitting(true);

		try {
			const result = await requestOtpWithBff(phone);

			if (result.errors?.length) {
				setError(result.errors[0].message || "Failed to send OTP code");
				return;
			}

			if (result.ok) {
				setStep(2);
				setSuccessMessage(`OTP code has been sent successfully to ${phone}`);
				return;
			}

			setError("Failed to send OTP. Please try again.");
		} catch {
			setError("An unexpected network error occurred.");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleVerifyOtp = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		if (!otp || otp.length !== 6) {
			setError("Please enter the 6-digit OTP code sent to your phone");
			return;
		}

		setIsSubmitting(true);

		try {
			const result = await verifyOtpWithBff(phone, otp);

			if (result.errors?.length) {
				setError(result.errors[0].message || "Invalid OTP code entered");
				return;
			}

			if (result.ok) {
				await syncAuthSurfacesAfterSignIn(params.channel, router, {
					redirectTo: buildStorefrontPath(params.locale, params.channel),
				});
				return;
			}

			setError("Verification failed. Please try again.");
		} catch {
			setError("An unexpected network error occurred.");
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="mx-auto my-16 w-full max-w-md">
			<div className="rounded-lg border border-border bg-card p-8 shadow-sm">
				<div className="mb-6 text-center">
					<h1 className="text-balance text-h1">OTP Sign In</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Authenticate securely using your mobile phone number
					</p>
				</div>

				{error && (
					<div role="alert" className="mb-4 bg-destructive/10 rounded-md p-3 text-sm text-destructive">
						{error}
					</div>
				)}

				{successMessage && (
					<div role="status" className="mb-4 rounded-md bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600">
						{successMessage}
					</div>
				)}

				{step === 1 ? (
					<form onSubmit={handleSendOtp} className="space-y-4">
						<div className="space-y-1.5">
							<Label htmlFor="phone" className="text-sm font-medium">
								Mobile Phone Number
							</Label>
							<div className="relative">
								<Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									id="phone"
									type="tel"
									placeholder="+919944758128"
									value={phone}
									onChange={(e) => setPhone(e.target.value)}
									className="h-12 pl-10"
									required
								/>
							</div>
							<p className="text-[10px] text-muted-foreground leading-normal">
								Make sure to include your country code (e.g. +91 for India, +1 for US) prefix.
							</p>
						</div>

						<Button type="submit" disabled={isSubmitting} className="h-12 w-full text-base font-semibold">
							{isSubmitting ? "Sending OTP..." : "Send OTP Verification"}
						</Button>
					</form>
				) : (
					<form onSubmit={handleVerifyOtp} className="space-y-4">
						<div className="space-y-1.5">
							<Label className="text-sm font-medium">Phone Number</Label>
							<div className="flex items-center space-x-2">
								<div className="relative flex-1">
									<Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<Input
										type="text"
										value={phone}
										disabled
										className="h-12 pl-10 bg-muted cursor-not-allowed"
									/>
								</div>
								<button
									type="button"
									onClick={() => setStep(1)}
									className="h-12 w-12 border border-border rounded-md flex items-center justify-center hover:bg-secondary transition-colors"
									title="Edit phone number"
								>
									<Pencil className="h-4 w-4 text-foreground" />
								</button>
							</div>
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="otp" className="text-sm font-medium">
								Verification Code
							</Label>
							<div className="relative">
								<Shield className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									id="otp"
									type="text"
									inputMode="numeric"
									maxLength={6}
									placeholder="Enter 6-digit code"
									value={otp}
									onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
									className="h-12 pl-10 tracking-[0.2em] font-mono text-center text-lg"
									required
								/>
							</div>
						</div>

						<div className="flex justify-end space-x-2 text-xs">
							<button
								type="button"
								onClick={handleSendOtp}
								disabled={isSubmitting}
								className="text-muted-foreground underline underline-offset-2 hover:text-foreground hover:no-underline disabled:opacity-50"
							>
								Resend Verification Code
							</button>
						</div>

						<Button type="submit" disabled={isSubmitting} className="h-12 w-full text-base font-semibold">
							{isSubmitting ? "Verifying..." : "Verify & Sign In"}
						</Button>
					</form>
				)}
			</div>
		</div>
	);
}
