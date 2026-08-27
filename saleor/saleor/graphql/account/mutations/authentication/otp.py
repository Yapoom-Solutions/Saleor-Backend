import graphene
import requests
from django.core.exceptions import ValidationError

from .....account.models import User
from .....core.jwt import create_access_token, create_refresh_token
from ....core.mutations import BaseMutation
from ....core.types import AccountError
from ...types import User as UserType
from .utils import _get_new_csrf_token
from .....plugins.manager import get_plugins_manager
from .....plugins.otp.plugin import OtpPlugin

class OTPRequest(BaseMutation):
    class Arguments:
        phone = graphene.String(required=True, description="The phone number to send OTP to.")

    class Meta:
        description = "Triggers an OTP verification request via the tenant's SMS extension."
        error_type_class = AccountError
        error_type_field = "account_errors"

    success = graphene.Boolean()

    @classmethod
    def perform_mutation(cls, _root, info, /, *, phone):
        manager = get_plugins_manager(allow_replica=False)
        plugin = manager.get_plugin(OtpPlugin.PLUGIN_ID)
        
        if not plugin or not plugin.active or not plugin.service_url:
            raise ValidationError(
                "OTP Authentication plugin is not active or configured for this tenant.",
                code="OTP_NOT_CONFIGURED"
            )

        domain = info.context.get_host()

        # Delegate the request to the tenant's configured service_url
        try:
            response = requests.post(
                f"{plugin.service_url.rstrip('/')}/api/request-otp",
                json={"phone": phone, "domain": domain},
                timeout=5
            )
            if response.status_code != 200:
                error_msg = response.json().get("error", "Failed to send OTP")
                raise ValidationError(error_msg, code="OTP_SEND_FAILED")
        except requests.RequestException as e:
            raise ValidationError(f"Could not connect to OTP service: {str(e)}", code="OTP_SERVICE_UNAVAILABLE")

        return OTPRequest(success=True)


class OTPConfirm(BaseMutation):
    class Arguments:
        phone = graphene.String(required=True, description="Phone number verified.")
        otp = graphene.String(required=True, description="OTP code entered by user.")

    class Meta:
        description = "Verifies OTP code and signs the user in, returning auth tokens."
        error_type_class = AccountError
        error_type_field = "account_errors"

    token = graphene.String()
    refresh_token = graphene.String()
    csrf_token = graphene.String()
    user = graphene.Field(UserType)

    @classmethod
    def perform_mutation(cls, _root, info, /, *, phone, otp):
        manager = get_plugins_manager(allow_replica=False)
        plugin = manager.get_plugin(OtpPlugin.PLUGIN_ID)
        
        if not plugin or not plugin.active or not plugin.service_url:
            raise ValidationError(
                "OTP Authentication plugin is not active or configured for this tenant.",
                code="OTP_NOT_CONFIGURED"
            )

        domain = info.context.get_host()

        # Verify code with the tenant's configured service_url
        try:
            response = requests.post(
                f"{plugin.service_url.rstrip('/')}/api/verify-otp",
                json={"phone": phone, "otp": otp, "domain": domain},
                timeout=5
            )
            if response.status_code != 200:
                error_msg = response.json().get("error", "Verification failed")
                raise ValidationError(error_msg, code="OTP_VERIFICATION_FAILED")
        except requests.RequestException as e:
            raise ValidationError(f"Could not connect to OTP service: {str(e)}", code="OTP_SERVICE_UNAVAILABLE")

        # Map phone to a synthetic email unique identifier
        email = f"{phone}@otp.localhost"

        # Find or create user
        user, created = User.objects.get_or_create(
            email=email,
            defaults={"is_active": True, "is_confirmed": True}
        )

        # Store mobile number in metadata
        user.store_value_in_metadata({"mobile_number": phone, "phone": phone})
        user.save(update_fields=["metadata"])

        csrf_token = _get_new_csrf_token()
        token = create_access_token(user)
        refresh_token = create_refresh_token(user)

        return OTPConfirm(
            token=token,
            refresh_token=refresh_token,
            csrf_token=csrf_token,
            user=user
        )
