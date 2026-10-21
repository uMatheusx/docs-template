import type { Environment } from "@/components/api/spec";
import { usePersistedState } from "@/hooks/use-persisted-state";

/** Ambiente escolhido para os exemplos de código (lembrado pelo nome entre páginas). */
export function useEnvironment(environments: Environment[]) {
  const [name, setName] = usePersistedState<string | null>("ah-api-env", null);
  const selected = environments.find((e) => e.name === name) ?? environments.find((e) => e.isDefault) ?? environments[0];
  return [selected, (env: Environment) => setName(env.name)] as const;
}
