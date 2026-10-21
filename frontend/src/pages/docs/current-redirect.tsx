import { Navigate, useParams } from "react-router";

/** Links antigos de releases congeladas (/docs/v/<release>/...) levam sempre à versão atual. */
export default function CurrentVersionRedirect() {
  const { "*": rest = "" } = useParams();
  return <Navigate to={rest ? `/docs/${rest}` : "/docs"} replace />;
}
