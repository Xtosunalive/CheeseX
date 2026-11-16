import { useEffect, useState } from "react";
import { fetchArticleDerivation, type ArticleDerivation } from "../lib/api";

export function useArticleDerivation(version: string | undefined): ArticleDerivation | null {
  const [data, setData] = useState<ArticleDerivation | null>(null);

  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    fetchArticleDerivation()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return data?.version === version ? data : null;
}
