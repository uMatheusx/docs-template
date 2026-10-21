import { ArrowLeft, ArrowRight, Eye, EyeOff, GitBranch, History, KeyRound, Loader2, UserRound, Workflow } from "lucide-react";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";

import { Logo } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";

const FEATURES = [
  { icon: Workflow, title: "Diagramas vivos", text: "Mermaid renderizado enquanto você escreve." },
  { icon: GitBranch, title: "Estrutura arrastável", text: "Reorganize a doctree com arrastar e soltar." },
  { icon: History, title: "Histórico com diff", text: "Compare e restaure qualquer versão salva no S3." },
];

export default function LoginPage() {
  const { user, login, isLoading } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/admin";

  if (!isLoading && user) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(undefined);
    try {
      await login(String(form.get("username")), String(form.get("password")));
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no login");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* painel da marca */}
      <section className="relative hidden overflow-hidden bg-muted p-12 lg:flex lg:flex-col">
        <div className="relative flex items-center gap-3">
          <Logo className="h-10 w-10" />
          <span className="font-display text-lg font-semibold">Account Hub</span>
        </div>

        <div className="relative my-auto max-w-lg">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-5xl font-semibold leading-[1.08] tracking-[-0.03em]"
          >
            Escreva uma vez, explique para todos.
          </motion.h1>
          <p className="mt-5 max-w-sm text-[19px] leading-snug text-muted-foreground">O Studio onde a documentação do Account Hub é escrita, revisada e publicada.</p>
          <ul className="mt-10 max-w-sm space-y-5">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background text-brand-ink">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="text-sm text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* formulário */}
      <section className="relative flex flex-col px-6 py-6 sm:px-12">
        <div className="flex items-center justify-between">
          <Link to="/docs" className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Documentação
          </Link>
          <ThemeToggle />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
          className="m-auto w-full max-w-sm py-12"
        >
          <Logo className="h-12 w-12 lg:hidden" />
          <h2 className="mt-6 font-display text-3xl font-semibold tracking-tight lg:mt-0">Bem-vindo de volta</h2>
          <p className="mt-2 text-muted-foreground">Entre para editar e publicar a documentação.</p>

          <form onSubmit={onSubmit} className="mt-9 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username">Usuário</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="username" name="username" autoComplete="username" required autoFocus className="h-12 pl-10" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  className="h-12 px-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive"
              >
                {error}
              </motion.p>
            )}
            <Button type="submit" size="lg" className="group w-full" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Entrar no Studio
              {!submitting && <ArrowRight className="transition-transform group-hover:translate-x-1" />}
            </Button>
          </form>
        </motion.div>
      </section>
    </div>
  );
}
