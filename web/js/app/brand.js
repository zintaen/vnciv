// CyberSkill (the studio that makes this atlas): one place for its links. Every link opens in a new tab with
// rel="noopener" and plain UTM tags naming where on the atlas it was clicked (no trackers, no remote assets).
export const CYBERSKILL = "https://cyberskill.world";

/** A cyberskill.world link: place = the utm_campaign (e.g. "author", "almanac"), path = "vi" | "en" | "". */
export const cyberskillUrl = (place, path = "") =>
  `${CYBERSKILL}/${path}?utm_source=atlasvn&utm_medium=referral&utm_campaign=${encodeURIComponent(place)}`;

/** The atlas's own open-source repository (MIT). */
export const REPO_URL = "https://github.com/zintaen/vnciv";
/** GitHub's mark, inline (no remote assets), for links to the repository. */
export const GITHUB_SVG = '<svg class="icon gh" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.14.46.55.38A8 8 0 0 0 8 0z"/></svg>';
