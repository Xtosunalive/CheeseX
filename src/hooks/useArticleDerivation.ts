import { useEffect, useState } from "react";
import { fetchArticleDerivation, type ArticleDerivation } from "../lib/api";

interface UseArticleDerivationResult {
  data: ArticleDerivation | null;
  loading: boolean;
  error: string | null;
}

export function useArticleDerivation(): UseArticleDerivationResult {
  const [data, setData] = useState<ArticleDerivation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchArticleDerivation()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
