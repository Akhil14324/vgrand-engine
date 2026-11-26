"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DEMO_EMAIL, DEMO_LOGIN_ENABLED, DEMO_PASSWORD } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

interface FieldErrors {
  email?: string;
  password?: string;
}

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = "Enter your email address.";
  else if (!EMAIL_RE.test(email.trim()))
    errors.email = "Enter a valid email address, like name@example.com.";
  if (!password) errors.password = "Enter your password.";
  else if (password.length < MIN_PASSWORD)
    errors.password = `Password must be at least ${MIN_PASSWORD} characters.`;
  return errors;
}

/** Supabase's wording is terse ("Invalid login credentials") — make it clear. */
function friendlyAuthError(err: unknown, mode: "signin" | "signup"): string {
  const msg = err instanceof Error ? err.message : "";
  if (mode === "signin" && /invalid login credentials|invalid.*(email|password)/i.test(msg))
    return "Incorrect email or password. Please check them and try again.";
  if (/email not confirmed/i.test(msg))
    return "This email isn't confirmed yet. Check your inbox for the confirmation link.";
  if (/failed to fetch|network/i.test(msg))
    return "Can't reach the sign-in service. Check your connection and try again.";
  return msg || "Authentication failed. Please try again.";
}

export default function LoginPage() {
  const { user, configured, loading, signInWithEmail, signUpWithEmail } =
    useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A successful sign-in sets `user` via onAuthStateChange — that is what
  // sends the user to the main dashboard, for demo and real accounts alike.
  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  if (!configured) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Sign-in isn&apos;t configured. Set NEXT_PUBLIC_SUPABASE_URL and
        NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.
      </div>
    );
  }

  if (loading || user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const authenticate = async (
    nextEmail: string,
    nextPassword: string,
    nextMode: "signin" | "signup",
  ) => {
    const errors = validate(nextEmail, nextPassword);
    setFieldErrors(errors);
    setError(null);
    setNotice(null);
    if (errors.email || errors.password) return;
    setBusy(true);
    try {
      if (nextMode === "signin")
        await signInWithEmail(nextEmail.trim(), nextPassword);
      else if (!(await signUpWithEmail(nextEmail.trim(), nextPassword))) {
        setNotice("Account created — check your email to confirm it, then sign in.");
        setMode("signin");
        setBusy(false);
      }
    } catch (err) {
      setError(friendlyAuthError(err, nextMode));
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void authenticate(email, password, mode);
  };

  const useDemoAccount = () => {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    setMode("signin");
    void authenticate(DEMO_EMAIL, DEMO_PASSWORD, "signin");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center sm:mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/catgpt-paw.png"
            alt="CatGPT"
            className="mx-auto h-20 w-auto rounded-2xl bg-white object-contain p-2 sm:h-24"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            Chat with AI and create images
          </p>
        </div>

        {DEMO_LOGIN_ENABLED && mode === "signin" && (
          <div className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">
              Demo account (for testing only)
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-muted-foreground">
              <dt>Email:</dt>
              <dd className="select-all break-all font-mono text-foreground">
                {DEMO_EMAIL}
              </dd>
              <dt>Password:</dt>
              <dd className="select-all break-all font-mono text-foreground">
                {DEMO_PASSWORD}
              </dd>
            </dl>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              disabled={busy}
              onClick={useDemoAccount}
            >
              Use demo account
            </Button>
          </div>
        )}

        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div>
            <label htmlFor="login-email" className="sr-only">
              Email
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="Email"
              value={email}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors((f) => ({ ...f, email: undefined }));
              }}
            />
            {fieldErrors.email && (
              <p id="login-email-error" className="mt-1 text-xs text-destructive">
                {fieldErrors.email}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="login-password" className="sr-only">
              Password
            </label>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="Password"
                className="pr-10"
                value={password}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={
                  fieldErrors.password ? "login-password-error" : undefined
                }
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password)
                    setFieldErrors((f) => ({ ...f, password: undefined }));
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {fieldErrors.password && (
              <p id="login-password-error" className="mt-1 text-xs text-destructive">
                {fieldErrors.password}
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setFieldErrors({});
          }}
          className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "signin"
            ? "Need an account? Sign up"
            : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
