from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="../.env", extra="ignore")

    # Groq
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Azure DevOps
    ado_organization: str = "https://dev.azure.com/Aptean"
    ado_project: str = "Next Business Event Manager"
    ado_team: str = "Next Business Event Manager Team"
    ado_pat: str = ""

    # AppCentral (CXT cases) — service credential not yet issued.
    # Expect an OAuth2 client-credentials grant against the Keycloak realm at
    # {appcentral_base_url}/iam/auth/realms/aptean, or a long-lived API key if
    # Kong is configured to accept one for this route. Leave blank until the
    # AppCentral/CXT platform team issues a machine-to-machine credential —
    # appcentral_client.py raises if a call is attempted with these unset.
    appcentral_base_url: str = "https://appcentral-int.aptean.com"
    appcentral_client_id: str = ""
    appcentral_client_secret: str = ""
    appcentral_api_key: str = ""

    # AppCentral "sync" webhook — a user-configured Flow endpoint that returns
    # the ticket list directly (no session cookie needed). Confirmed working:
    # POST with no auth/body required, returns a JSON array of CXT cases in
    # the same shape as /aurora/be/api/cxt/cases/search/'s "cases" results.
    appcentral_sync_webhook_url: str = ""

    # App
    app_env: str = "development"
    secret_key: str = "change-me"
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
