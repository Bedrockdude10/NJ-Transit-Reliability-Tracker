import { Redirect, useLocalSearchParams } from "expo-router";

/**
 * Redirect an old single-purpose route onto its tab of a grouped page.
 *
 * The twelve top-level routes became five, but links to the old ones are in
 * bookmarks, in the sitemap and in other people's pages — so each old path
 * stays as a redirect rather than a 404. Existing query params ride along, so
 * a shared `/commute?origin=…&window=90d` still lands on the same view.
 */
export function RedirectTo({ pathname, tab }: { pathname: string; tab: string }) {
  const params = useLocalSearchParams();
  return <Redirect href={{ pathname, params: { ...params, tab } } as never} />;
}
