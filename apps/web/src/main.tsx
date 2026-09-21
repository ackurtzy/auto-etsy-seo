import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider, Show, SignInButton, UserButton, useAuth } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const demoMode = import.meta.env.VITE_GATE_DEMO_MODE === "true";
const localOwnerMode = import.meta.env.VITE_LOCAL_OWNER_MODE === "true";
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const root = createRoot(document.getElementById("root")!);
if (demoMode) {
  root.render(<StrictMode><QueryClientProvider client={queryClient}><App getToken={async () => "demo"} demoMode /></QueryClientProvider></StrictMode>);
} else if (localOwnerMode) {
  root.render(<StrictMode><QueryClientProvider client={queryClient}><App getToken={async () => "local-owner"} accountControl={<span>Local owner</span>} /></QueryClientProvider></StrictMode>);
} else if (!publishableKey) {
  root.render(<main className="signed-out" role="alert"><span className="eyebrow">Auto Etsy SEO</span><h1>Secure sign-in is not configured</h1><p>This deployment is intentionally unavailable until its Clerk publishable key is configured. No Etsy operation can be submitted.</p></main>);
} else {
  root.render(
    <StrictMode>
      <ClerkProvider publishableKey={publishableKey}>
        <QueryClientProvider client={queryClient}>
          <Show when="signed-in" fallback={<main className="signed-out"><span className="eyebrow">Auto Etsy SEO</span><h1>Owner sign-in required</h1><p>Mutation and recovery controls are available only to an authorized tenant member.</p><SignInButton><button className="primary">Sign in</button></SignInButton></main>}>
            <AuthenticatedApp />
          </Show>
        </QueryClientProvider>
      </ClerkProvider>
    </StrictMode>,
  );
}

function AuthenticatedApp() {
  const { getToken } = useAuth();
  return <App getToken={getToken} accountControl={<UserButton />} />;
}
