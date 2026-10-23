import { GitPullRequest } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import type { Review } from "@/lib/api";
import { REVIEW_STATUS } from "@/lib/reviews/labels";

/** Faixa do editor sobre as propostas da página: a sua (para carregar no editor) e as de outras pessoas. */
export function ReviewBanner({
  mine,
  others,
  reviewOnly,
  origin,
  current,
  onLoad,
}: {
  mine?: Review;
  others: Review[];
  /** página publicada: as alterações viram proposta */
  reviewOnly: boolean;
  /** versão x.y.z em que o rascunho se baseia e a atual da página */
  origin: { version: number; semver: string };
  current: { version: number; semver: string };
  onLoad: (review: Review) => void;
}) {
  if (!reviewOnly && !mine && others.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-sky-500/[0.07] px-5 py-2 text-sm">
      <GitPullRequest className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
      {mine ? (
        <>
          <span className="font-semibold">
            Sua proposta #{mine.number} “{mine.title}” está {REVIEW_STATUS[mine.status].label.toLowerCase()}.
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onLoad(mine)}>
              Carregar no editor
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to={`/admin/reviews/${mine.id}`}>Abrir proposta</Link>
            </Button>
          </span>
        </>
      ) : (
        reviewOnly && <span className="font-semibold">Página publicada: suas alterações viram uma proposta que um administrador revisa.</span>
      )}
      {reviewOnly && origin.version !== current.version && (
        <span className="text-xs text-muted-foreground">
          Seu rascunho foi feito sobre a versão {origin.semver}; a página já está na {current.semver}. As mudanças se combinam quando a proposta
          for aplicada.
        </span>
      )}
      {others.length > 0 && (
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {others.length === 1 ? "1 proposta aberta" : `${others.length} propostas abertas`} nesta página:
          {others.slice(0, 3).map((r) => (
            <Link
              key={r.id}
              to={`/admin/reviews/${r.id}`}
              className="rounded-full border bg-background px-2 py-0.5 font-semibold text-foreground hover:border-brand/40"
            >
              #{r.number} · {r.author}
            </Link>
          ))}
        </span>
      )}
    </div>
  );
}
