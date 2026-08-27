from typing import Optional
from ..base_plugin import BasePlugin, PluginConfigurationType

class OtpPlugin(BasePlugin):
    PLUGIN_ID = "saleor.auth.otp"
    PLUGIN_NAME = "OTP Authentication"
    PLUGIN_DESCRIPTION = "Delegates OTP generation and verification to tenant-specific microservices."
    DEFAULT_ACTIVE = True
    CONFIGURATION_PER_CHANNEL = False

    CONFIG_STRUCTURE = {
        "service_url": {
            "type": "String",
            "help_text": "Internal URL of this tenant's OTP provider extension (e.g., http://otp-app:8081)",
            "label": "OTP Extension Service URL"
        }
    }

    DEFAULT_CONFIGURATION = [
        {"name": "service_url", "value": ""}
    ]

    def __init__(
        self,
        *,
        configuration: PluginConfigurationType,
        active: bool,
        channel: Optional["Channel"] = None,
        **kwargs,
    ):
        super().__init__(configuration=configuration, active=active, channel=channel, **kwargs)
        # Convert to dict to easily extract configuration parameters
        config_dict = {item["name"]: item["value"] for item in self.configuration}
        self.service_url = config_dict.get("service_url")
