export type SecretBindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  ETSY_API_KEY: string;
  ETSY_CLIENT_ID: string;
  CREDENTIAL_ENCRYPTION_KEY: string;
  RESEND_API_KEY: string;
  INCIDENT_EMAIL: string;
};

export type AppEnv = Env & SecretBindings;
