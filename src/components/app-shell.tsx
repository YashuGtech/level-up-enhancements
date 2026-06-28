import { Outlet, Link } from "@tanstack/react-router";
import { ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, AlertTriangle, KeyRound, LogIn } from "lucide-react";
import { useSession } from "@/lib/session";
import { BottomNav } from "@/components/bottom-nav";
import { GoldLoader } from "@/components/gold-loader";
import { GoldFrame } from "@/components/gold-ui";
import { dismissMyLock, dismissMyBroadcastLock } from "@/lib/locks.functions";
import { webLoginWidget, webLoginPreview } from "@/lib/web-auth.functions";

const BOT_USERNAME = "GTCgames_bot";

type TgUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

declare global {
  interface Window {
    onTelegramAuthInline?: (u: TgUser) => void;
  }
}

function isPreviewHost(host: string) {
  return (
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovable.dev") ||
    host.endsWith(".gpt-eng.com") ||
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1")
  );
}

function InlineTelegramLogin() {
  const { signInWithWebToken } = useSession();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPreview(isPreviewHost(window.location.host));
  }, []);

  useEffect(() => {
    if (preview) return;
    if (!hostRef.current) return;
    hostRef.current.innerHTML = "";

    window.onTelegramAuthInline = async (tg) => {
      setBusy(true);
      try {
        const widgetData: Record<string, string> = {};
        Object.entries(tg).forEach(([k, v]) => {
          if (v != null) widgetData[k] = String(v);
        });
        const r = await webLoginWidget({ data: { widgetData } });
        await signInWithWebToken(r.token);
        toast.success("Signed in with Telegram");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Sign in failed");
      } finally {
        setBusy(false);
      }
    };

    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", BOT_USERNAME);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "8");
    s.setAttribute("data-onauth", "onTelegramAuthInline(user)");
    s.setAttribute("data-request-access", "write");
    hostRef.current.appendChild(s);

    return () => {
      delete window.onTelegramAuthInline;
    };
  }, [preview, signInWithWebToken]);

  async function handlePreview() {
    setBusy(true);
    try {
      const r = await webLoginPreview();
      await signInWithWebToken(r.token);
      toast.success("Signed in (preview mode)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preview sign in failed");
    } finally {
      setBusy(false);
    }
  }

  if (preview) {
    return (
      <button
        disabled={busy}
        onClick={() => void handlePreview()}
        className="mt-4 w-full rounded-md bg-gradient-gold-flat px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Signing in…" : "Continue as Preview User"}
      </button>
    );
  }

  return (
    <div className="mt-4 flex items-center justify-center min-h-[50px]" aria-busy={busy}>
      <div ref={hostRef} />
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { loading, error, user, lock, initData, refresh, authMode } = useSession();

  if (loading) return <GoldLoader label="Loading…" />;

  if (error || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <GoldFrame className="max-w-sm p-6 text-center">
          <h1 className="font-display text-xl text-gold-soft">
            {authMode === "telegram" ? "Authentication failed" : "Sign in to play"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {error ?? "Tap the Telegram button to sign in and start playing."}
          </p>

          <InlineTelegramLogin />

          {authMode === "telegram" && (
            <button
              onClick={() => void refresh()}
              className="mt-2 w-full rounded-md border border-gold-soft/40 bg-black/40 px-4 py-2 text-sm text-gold-soft"
            >
              Retry Telegram
            </button>
          )}

          <Link
            to="/auth"
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-gold-soft/40 bg-black/40 px-4 py-2 text-xs text-gold-soft"
          >
            <LogIn className="h-3.5 w-3.5" /> More sign-in options
          </Link>
          <Link
            to="/trial"
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-gold-soft/50 bg-black/40 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-gold-soft"
          >
            <KeyRound className="h-3.5 w-3.5" /> Trial Access
          </Link>
        </GoldFrame>
      </div>
    );
  }

  if (lock && initData) {
    return <LockGate message={lock.message} url={lock.url} scope={lock.scope} initData={initData} onCleared={() => void refresh()} />;
  }

  return (
    <div className="relative mx-auto min-h-screen w-full max-w-md pb-20 bg-circuit">
      {children ?? <Outlet />}
      <BottomNav />
    </div>
  );
}

// Keep unused import out of warnings

function LockGate({
  message,
  url,
  scope,
  initData,
  onCleared,
}: {
  message: string;
  url: string;
  scope: "user" | "broadcast";
  initData: string;
  onCleared: () => void;
}) {
  const [clicking, setClicking] = useState(false);

  const handleClick = async () => {
    setClicking(true);
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      /* ignore */
    }
    try {
      if (scope === "broadcast") {
        await dismissMyBroadcastLock({ data: { initData } });
      } else {
        await dismissMyLock({ data: { initData } });
      }
    } catch {
      /* still let them through — server will retry next bootstrap */
    }
    onCleared();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <GoldFrame className="w-full max-w-md p-6 text-center" glow>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-destructive bg-black/60 shadow-gold">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="mt-4 font-display text-2xl text-gradient-gold">Action Required</h1>
        <p className="mt-3 whitespace-pre-wrap text-sm text-gold-soft">{message}</p>
        <p className="mt-3 text-[11px] uppercase tracking-widest text-muted-foreground">
          You must click the link below to continue using the bot.
        </p>
        <button
          onClick={handleClick}
          disabled={clicking}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 border-gold bg-gradient-gold-flat px-6 py-4 font-display text-base font-bold uppercase tracking-widest text-primary-foreground shadow-gold transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          <ExternalLink className="h-4 w-4" />
          Click here
        </button>
        <p className="mt-3 text-[10px] text-muted-foreground">
          This appears one time only. After you click, the bot unlocks for you.
        </p>
      </GoldFrame>
    </div>
  );
}


