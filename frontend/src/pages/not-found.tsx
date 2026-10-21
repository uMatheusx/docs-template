import { Compass, Home } from "lucide-react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";

import { Logo } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const error = useRouteError();
  const message = error
    ? isRouteErrorResponse(error)
      ? `${error.status}: ${error.statusText}`
      : error instanceof Error
        ? error.message
        : "Erro inesperado"
    : "O endereço que você tentou acessar não existe ou mudou de lugar.";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <Logo className="h-10 w-10" />
      <h1 className="mt-8 font-display text-[5rem] font-semibold leading-none tracking-[-0.04em] sm:text-[7rem]">
        {error ? "Ops" : "404"}
      </h1>
      <p className="mt-4 max-w-md text-[17px] text-muted-foreground">{message}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button asChild size="lg">
          <Link to="/docs">
            <Home /> Ir para a documentação
          </Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link to="/admin">
            <Compass /> Abrir o Studio
          </Link>
        </Button>
      </div>
    </div>
  );
}
