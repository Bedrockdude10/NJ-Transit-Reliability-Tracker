import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Redirect an old single-purpose route onto its tab of a grouped page, so
 * bookmarks and sitemap links do not 404. Query params ride along.
 */
export function RedirectTo({ pathname, tab }: { pathname: string; tab: string }) {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname, params: { ...params, tab } } as never} />;
}
