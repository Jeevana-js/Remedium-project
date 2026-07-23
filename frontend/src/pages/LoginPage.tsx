import { useState } from "react";
import { Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import { useAuthStore, validatePassword } from "../store/useAuthStore";

interface Rule { label: string; test: (p: string) => boolean }
const RULES: Rule[] = [
  { label: "At least 8 characters",       test: (p) => p.length >= 8 },
  { label: "One uppercase letter (A–Z)",   test: (p) => /[A-Z]/.test(p) },
  { label: "One number (0–9)",             test: (p) => /[0-9]/.test(p) },
  { label: "One special character (!@#…)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

function PasswordRules({ password }: { password: string }) {
  return (
    <div className="bg-surface-3/60 border border-surface-3 rounded-lg px-3 py-2.5 space-y-1.5 mt-1">
      {RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <div key={rule.label} className="flex items-center gap-2">
            {met
              ? <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />
              : <XCircle size={12} className="text-slate-600 flex-shrink-0" />}
            <span className={`text-xs ${met ? "text-green-400" : "text-slate-500"}`}>
              {rule.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FieldError({ msg }: { msg: string }) {
  return (
    <p className="text-xs text-red-400 flex items-center gap-1 mt-1">
      <XCircle size={12} /> {msg}
    </p>
  );
}

function InputField({
  label, type = "text", value, onChange, placeholder, error, autoFocus, children,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
  error?: string; autoFocus?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</label>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={`w-full bg-surface-3 border rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
            error ? "border-red-500/60 focus:ring-red-500" : "border-surface-3 focus:ring-brand-500"
          } ${children ? "pr-10" : ""}`}
        />
        {children}
      </div>
      {error && <FieldError msg={error} />}
    </div>
  );
}

/* ─── Login Form ─── */
function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [pwErr, setPwErr]         = useState("");
  const [loading, setLoading]     = useState(false);

  const allMet = RULES.every((r) => r.test(password));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwErr("");
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);
    if (result === "ok") return;
    if (result === "invalid") setPwErr("Invalid email or password.");
    if (result === "error")   setPwErr("Server error. Make sure the backend is running.");
  };

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Welcome back</h2>
        <p className="text-xs text-slate-500 mt-0.5">Sign in to your account</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <InputField
          label="Email" type="email" value={email}
          onChange={(v) => { setEmail(v); setPwErr(""); }}
          placeholder="you@aptean.com" autoFocus
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPwErr(""); setShowRules(true); }}
              onFocus={() => setShowRules(true)}
              placeholder="••••••••"
              className={`w-full bg-surface-3 border rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
                pwErr ? "border-red-500/60 focus:ring-red-500" : "border-surface-3 focus:ring-brand-500"
              }`}
            />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {showRules && password.length > 0 && <PasswordRules password={password} />}
          {pwErr && <FieldError msg={pwErr} />}
        </div>

        <button type="submit" disabled={!email.trim() || !allMet || loading}
          className="w-full btn-primary py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="text-xs text-center text-slate-500">
        Don't have an account?{" "}
        <button onClick={onSwitch} className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
          Create one
        </button>
      </p>
    </>
  );
}

/* ─── Register Form ─── */
function RegisterForm({ onSwitch }: { onSwitch: () => void }) {
  const register = useAuthStore((s) => s.register);
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRules, setShowRules]     = useState(false);
  const [nameErr, setNameErr]   = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [pwErr, setPwErr]       = useState("");
  const [confirmErr, setConfirmErr] = useState("");

  const allMet = RULES.every((r) => r.test(password));
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameErr(""); setEmailErr(""); setPwErr(""); setConfirmErr("");

    if (!name.trim()) { setNameErr("Name is required."); return; }
    if (!email.trim()) { setEmailErr("Email is required."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailErr("Enter a valid email address."); return; }
    if (!allMet) { setPwErr(validatePassword(password) ?? "Invalid password."); return; }
    if (password !== confirm) { setConfirmErr("Passwords do not match."); return; }

    setLoading(true);
    const result = await register(name.trim(), email.trim(), password);
    setLoading(false);
    if (result === "already_exists") setEmailErr("An account with this email already exists.");
    if (result === "error") setPwErr("Server error. Make sure the backend is running.");
  };

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Create account</h2>
        <p className="text-xs text-slate-500 mt-0.5">Fill in your details to get started</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <InputField label="Full name" value={name}
          onChange={(v) => { setName(v); setNameErr(""); }}
          placeholder="Jeevana Sakthi" error={nameErr} autoFocus />

        <InputField label="Email" type="email" value={email}
          onChange={(v) => { setEmail(v); setEmailErr(""); }}
          placeholder="you@aptean.com" error={emailErr} />

        {/* Password */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Password</label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setPwErr(""); setShowRules(true); }}
              onFocus={() => setShowRules(true)}
              placeholder="Create a strong password"
              className={`w-full bg-surface-3 border rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
                pwErr ? "border-red-500/60 focus:ring-red-500" : "border-surface-3 focus:ring-brand-500"
              }`}
            />
            <button type="button" onClick={() => setShowPw((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {showRules && password.length > 0 && <PasswordRules password={password} />}
          {pwErr && <FieldError msg={pwErr} />}
        </div>

        {/* Confirm password */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Confirm password</label>
          <div className="relative">
            <input
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setConfirmErr(""); }}
              placeholder="Re-enter your password"
              className={`w-full bg-surface-3 border rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:border-transparent transition-colors ${
                confirmErr ? "border-red-500/60 focus:ring-red-500" : confirm && confirm === password ? "border-green-500/50 focus:ring-green-500" : "border-surface-3 focus:ring-brand-500"
              }`}
            />
            <button type="button" onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
              {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {confirm && confirm === password && !confirmErr && (
            <p className="text-xs text-green-400 flex items-center gap-1 mt-1">
              <CheckCircle2 size={12} /> Passwords match
            </p>
          )}
          {confirmErr && <FieldError msg={confirmErr} />}
        </div>

        <button type="submit"
          disabled={!name.trim() || !email.trim() || !allMet || password !== confirm || loading}
          className="w-full btn-primary py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="text-xs text-center text-slate-500">
        Already have an account?{" "}
        <button onClick={onSwitch} className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
          Sign in
        </button>
      </p>
    </>
  );
}

/* ─── Page ─── */
export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Remedium<span className="text-brand-500">.</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Support Intelligence Platform</p>
        </div>

        <div className="card p-8 space-y-5">
          {mode === "login"
            ? <LoginForm onSwitch={() => setMode("register")} />
            : <RegisterForm onSwitch={() => setMode("login")} />}
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">Aptean · Internal Tool · v0.1.0</p>
      </div>
    </div>
  );
}
