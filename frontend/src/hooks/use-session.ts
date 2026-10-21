import useSWR, { useSWRConfig } from "swr";

import { docsApi, keys, type SiteInfo } from "@/lib/api";

export function useSession() {
  const { data, error, isLoading, mutate } = useSWR<SiteInfo>(keys.site);
  const { mutate: globalMutate } = useSWRConfig();

  // Invalida tudo: a visão muda (rascunhos visíveis, rotas admin liberadas).
  const refreshAll = () => globalMutate(() => true);

  return {
    site: data,
    user: data?.user ?? null,
    isLoading,
    error,
    async login(username: string, password: string) {
      await docsApi.login(username, password);
      await mutate();
      await refreshAll();
    },
    async logout() {
      await docsApi.logout();
      await mutate();
      await refreshAll();
    },
  };
}
