"use client";

import { useState, useCallback, useMemo, useEffect, type FC } from "react";
import { ChevronLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/ui/components/ui/button";
import {
	CheckoutSummaryContext,
	buildPaymentSummaryRows,
	useCheckoutSummaryLabels,
} from "./checkout-summary-context";
import { type CheckoutFragment, type CountryCode, type AddressFragment } from "@/checkout/graphql";
import { useUser } from "@/checkout/hooks/use-user";
import { useCheckoutPayment } from "@/checkout/hooks/use-checkout-payment";
import { MobileStickyAction } from "./mobile-sticky-action";
import { useCheckoutStepNumber } from "@/checkout/hooks/use-checkout-steps";
import { useTranslations } from "next-intl";
import {
	PaymentGatewayAlerts,
	PaymentMethodArea,
	PaymentError,
	PaymentTrustSignals,
	BillingAddressSection,
	type BillingAddressData,
} from "@/checkout/components/payment";
import { LoadingSpinner } from "@/checkout/ui-kit/loading-spinner";
import { getFormattedMoney, formatMoneyWithFallback } from "@/checkout/lib/utils/money";
import { AuthorizedPaymentRecovery } from "@/checkout/components/payment/stripe/authorized-payment-recovery";
import { isCheckoutFreeOrder } from "@/checkout/lib/payment/checkout-pay-amount";
import { shouldShowPaymentMethodArea } from "@/checkout/lib/payment/should-show-payment-method-area";
import { usesClientPaymentSubmit } from "@/checkout/lib/payment";
import { consumePaymentCompletionError } from "@/checkout/lib/payment/checkout-payment-completion";
import { useCheckoutPaymentReturnError } from "@/checkout/providers/checkout-payment-return-error";
import { useSyncCheckoutRouterUrl } from "@/checkout/hooks/use-sync-checkout-router-url";

interface PaymentStepProps {
	checkout: CheckoutFragment;
	onBack: () => void;
	onGoToInformation?: () => void;
	onPaymentBusyChange?: (busy: boolean) => void;
}

export const PaymentStep: FC<PaymentStepProps> = ({
	checkout,
	onBack,
	onGoToInformation,
	onPaymentBusyChange,
}) => {
	useSyncCheckoutRouterUrl();

	const { user, authenticated } = useUser();
	const tActions = useTranslations("checkout.actions");
	const tPayment = useTranslations("checkout.payment");
	const isShippingRequired = checkout.isShippingRequired;
	const paymentStep = useCheckoutStepNumber("PAYMENT", isShippingRequired);
	const hasShippingAddress = !!checkout.shippingAddress;
	const shippingAddress = checkout.shippingAddress;

	const [isPaymentBusy, setIsPaymentBusy] = useState(false);
	const [sameAsBilling, setSameAsBilling] = useState(isShippingRequired && hasShippingAddress);
	const [billingData, setBillingData] = useState<BillingAddressData>(() => ({
		countryCode: (checkout.billingAddress?.country?.code as CountryCode) || "US",
		formData: {
			firstName: checkout.billingAddress?.firstName || "",
			lastName: checkout.billingAddress?.lastName || "",
			streetAddress1: checkout.billingAddress?.streetAddress1 || "",
			streetAddress2: checkout.billingAddress?.streetAddress2 || "",
			companyName: checkout.billingAddress?.companyName || "",
			city: checkout.billingAddress?.city || "",
			postalCode: checkout.billingAddress?.postalCode || "",
			countryArea: checkout.billingAddress?.countryArea || "",
			phone: checkout.billingAddress?.phone || "",
		},
	}));

	const { error: returnError, clearError: clearReturnError } = useCheckoutPaymentReturnError();

	const [razorpayLoading, setRazorpayLoading] = useState(false);
	const [razorpayError, setRazorpayError] = useState<string | null>(null);

	const handleRazorpayPayment = async () => {
		setRazorpayError(null);
		setRazorpayLoading(true);
		try {
			const scriptLoaded = await new Promise((resolve) => {
				const script = document.createElement("script");
				script.src = "https://checkout.razorpay.com/v1/checkout.js";
				script.onload = () => resolve(true);
				script.onerror = () => resolve(false);
				document.body.appendChild(script);
			});

			if (!scriptLoaded) {
				throw new Error("Failed to load Razorpay SDK");
			}

			const storefrontHost = window.location.host;
			const backendDomain = storefrontHost.includes(":") ? storefrontHost.replace(":3000", ":8000") : `${storefrontHost}:8000`;

			const res = await fetch("http://localhost:8080/api/razorpay/create-order", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					domain: backendDomain,
					checkout_id: checkout.id,
					amount: total?.amount.toString() || "0",
					currency: total?.currency || "INR"
				})
			});

			if (!res.ok) {
				const errData = (await res.json()) as any;
				throw new Error(errData.error || "Failed to create Razorpay order");
			}

			const orderData = (await res.json()) as any;

			const options = {
				key: orderData.razorpay_key_id,
				amount: orderData.amount,
				currency: orderData.currency,
				name: "Multi-Tenant Store",
				description: `Payment for checkout ${checkout.id.substring(0, 8)}`,
				order_id: orderData.order_id,
				handler: async function (_response: any) {
					setRazorpayLoading(true);
					try {
						const { completeCheckoutOrder } = await import("@/checkout/lib/payment/complete-order");
						const completeResult = await completeCheckoutOrder(checkout.id);
						if (completeResult.ok) {
							window.location.href = `/checkout/complete?order=${completeResult.orderId}`;
						} else {
							setRazorpayError(completeResult.error || "Failed to complete order after payment");
						}
					} catch (e: any) {
						setRazorpayError(e.message || "Failed to finalize checkout");
					} finally {
						setRazorpayLoading(false);
					}
				},
				modal: {
					ondismiss: function () {
						setRazorpayLoading(false);
					}
				},
				theme: {
					color: "#4f46e5"
				}
			};

			const rzp = new (window as any).Razorpay(options);
			rzp.open();
		} catch (err: any) {
			console.error("Razorpay error:", err);
			setRazorpayError(err.message || "An error occurred during payment");
			setRazorpayLoading(false);
		}
	};

	const {
		submit,
		errors,
		setPaymentError,
		setBillingErrors,
		setPriceChangeNotice,
		priceChangeNotice,
		provider,
		canSubmit,
		isLoading,
		isCompletingOrder,
	} = useCheckoutPayment({
		checkout,
		billingData,
		sameAsBilling,
		hasShippingAddress,
		shippingAddress,
		userAddresses: user?.addresses,
		authenticated,
	});

	const usesClientSubmit = usesClientPaymentSubmit(provider);
	const isFreeOrder = isCheckoutFreeOrder(checkout);

	const handlePaymentError = useCallback(
		(message: string) => {
			clearReturnError();
			setPaymentError(message);
		},
		[clearReturnError, setPaymentError],
	);

	useEffect(() => {
		const stashedError = consumePaymentCompletionError();
		if (stashedError) {
			handlePaymentError(stashedError);
		}
	}, [handlePaymentError]);

	const handlePaymentActivityChange = useCallback(
		(active: boolean) => {
			setIsPaymentBusy(active);
			onPaymentBusyChange?.(active);
		},
		[onPaymentBusyChange],
	);

	useEffect(() => {
		return () => {
			onPaymentBusyChange?.(false);
		};
	}, [onPaymentBusyChange]);

	const handleBillingDataChange = useCallback((data: BillingAddressData) => {
		setBillingData(data);
	}, []);

	const summaryLabels = useCheckoutSummaryLabels();
	const summaryRows = useMemo(
		() => buildPaymentSummaryRows(checkout, summaryLabels),
		[checkout, summaryLabels],
	);

	const handleGoToStep = (step: number) => {
		if (step === 1 && onGoToInformation) {
			onGoToInformation();
		} else if (step === 2) {
			onBack();
		}
	};

	const total = checkout.totalPrice?.gross;
	const totalStr = formatMoneyWithFallback(total);

	const buttonText = isLoading
		? isCompletingOrder
			? tActions("creatingOrder")
			: isFreeOrder
				? tActions("placingOrder")
				: tActions("processingPayment")
		: isFreeOrder
			? tActions("completeOrder")
			: tActions("payTotal", { total: totalStr });

	const hasInvalidDelivery = checkout.problems?.some(
		(p) => p.__typename === "CheckoutProblemDeliveryMethodInvalid",
	);

	const billingFieldErrors = useMemo(() => {
		const { payment, billing, ...fieldErrors } = errors;
		return fieldErrors;
	}, [errors]);

	const isDisabled = isLoading || hasInvalidDelivery || (!canSubmit && !isFreeOrder);

	const paymentContent = (
		<>
			{priceChangeNotice ? (
				<div
					className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4"
					role="status"
				>
					<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
					<div>
						<p className="font-medium text-amber-800">{tPayment("totalUpdatedTitle")}</p>
						<p className="mt-1 text-sm text-amber-700">
							{tPayment("totalUpdatedBody", {
								previous: getFormattedMoney({
									amount: priceChangeNotice.previousAmount,
									currency: priceChangeNotice.currency,
								}),
								next: getFormattedMoney({
									amount: priceChangeNotice.newAmount,
									currency: priceChangeNotice.currency,
								}),
							})}
						</p>
					</div>
				</div>
			) : null}

			<CheckoutSummaryContext
				checkout={checkout}
				rows={summaryRows}
				onGoToStep={isPaymentBusy ? undefined : handleGoToStep}
			/>

			{hasInvalidDelivery && (
				<div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
					<AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
					<div>
						<p className="font-medium text-amber-800">{tPayment("deliveryInvalidTitle")}</p>
						<p className="mt-1 text-sm text-amber-700">{tPayment("deliveryInvalidBody")}</p>
					</div>
				</div>
			)}

			<PaymentGatewayAlerts gateways={checkout.availablePaymentGateways} />

			{usesClientSubmit && !isFreeOrder ? (
				<AuthorizedPaymentRecovery checkout={checkout} onError={handlePaymentError} />
			) : null}

			{usesClientSubmit ? (
				<BillingAddressSection
					billingAddress={checkout.billingAddress}
					shippingAddress={shippingAddress}
					userAddresses={authenticated ? (user?.addresses as AddressFragment[]) : undefined}
					defaultBillingAddressId={user?.defaultBillingAddress?.id}
					isShippingRequired={isShippingRequired}
					errors={billingFieldErrors}
					sectionError={errors.billing}
					onChange={handleBillingDataChange}
					onSameAsShippingChange={setSameAsBilling}
					initialSameAsShipping={sameAsBilling}
					disabled={isPaymentBusy}
				/>
			) : null}

			<PaymentError message={errors.payment || returnError || undefined} />

			{/* Razorpay Secure Checkout Section */}
			<div className="border border-indigo-500/20 bg-indigo-950/10 rounded-xl p-6 my-6 shadow-sm">
				<div className="flex items-center space-x-3 mb-3">
					<div className="h-7 w-7 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-white text-xs shadow-md shadow-indigo-600/20">
						R
					</div>
					<h3 className="text-sm font-semibold text-white tracking-wide">Razorpay Secure Checkout</h3>
				</div>
				<p className="text-xs text-gray-400 mb-5 leading-relaxed">
					Pay securely using Credit/Debit cards, UPI, Wallets, or Netbanking.
				</p>
				{razorpayError && (
					<div className="mb-4 text-xs text-rose-500 bg-rose-950/20 border border-rose-500/20 p-3 rounded-lg flex items-center space-x-2">
						<AlertTriangle className="h-4 w-4 shrink-0" />
						<span>{razorpayError}</span>
					</div>
				)}
				<Button
					type="button"
					onClick={handleRazorpayPayment}
					disabled={isDisabled || razorpayLoading}
					className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center space-x-2"
				>
					{razorpayLoading ? (
						<>
							<LoadingSpinner />
							<span>Processing Payment...</span>
						</>
					) : (
						<span>Pay with Razorpay</span>
					)}
				</Button>
			</div>

			{shouldShowPaymentMethodArea(checkout) ? (
				<PaymentMethodArea
					provider={provider}
					checkout={checkout}
					billing={{
						billingData,
						sameAsBilling,
						hasShippingAddress,
						shippingAddress,
						userAddresses: user?.addresses,
						authenticated,
					}}
					onPaymentError={handlePaymentError}
					onBillingErrors={setBillingErrors}
					onPriceChangeNotice={setPriceChangeNotice}
					onPaymentActivityChange={handlePaymentActivityChange}
				/>
			) : null}

			{!usesClientSubmit ? (
				<BillingAddressSection
					billingAddress={checkout.billingAddress}
					shippingAddress={shippingAddress}
					userAddresses={authenticated ? (user?.addresses as AddressFragment[]) : undefined}
					defaultBillingAddressId={user?.defaultBillingAddress?.id}
					isShippingRequired={isShippingRequired}
					errors={billingFieldErrors}
					sectionError={errors.billing}
					onChange={handleBillingDataChange}
					onSameAsShippingChange={setSameAsBilling}
					initialSameAsShipping={sameAsBilling}
				/>
			) : null}

			<div className="flex items-center justify-between">
				<button
					type="button"
					onClick={onBack}
					disabled={isPaymentBusy}
					className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
				>
					<ChevronLeft className="h-4 w-4" />
					{isShippingRequired ? tActions("returnToShipping") : tActions("returnToInformation")}
				</button>
				{!usesClientSubmit ? (
					<div className="hidden flex-col items-end gap-3 md:flex">
						<PaymentTrustSignals />
						<Button type="submit" disabled={isDisabled} className="h-12 min-w-[200px] px-8">
							{isLoading ? (
								<span className="flex items-center gap-2">
									<LoadingSpinner />
									{buttonText}
								</span>
							) : (
								buttonText
							)}
						</Button>
					</div>
				) : null}
			</div>

			{!usesClientSubmit ? (
				<MobileStickyAction
					step={paymentStep}
					isShippingRequired={isShippingRequired}
					type="submit"
					onAction={submit}
					isLoading={isLoading}
					disabled={isDisabled}
					total={totalStr}
					loadingText={isCompletingOrder ? tActions("creatingOrder") : tActions("processingPayment")}
					showPaymentTrust
				/>
			) : null}
		</>
	);

	return (
		<>
			{usesClientSubmit ? (
				<div className="space-y-8">{paymentContent}</div>
			) : (
				<form className="space-y-8" onSubmit={submit}>
					{paymentContent}
				</form>
			)}
		</>
	);
};
