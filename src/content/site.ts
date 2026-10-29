/**
 * The site's own words: navigation, home and about copy.
 *
 * Edit freely. The site's NAME and LOGO are not here: they come from the
 * platform (`GET /site-api/site`), so a rename in the dashboard shows
 * up without a Publish. Use `{name}` in any string below for the site name.
 */

/** Search and social basics. The NAME comes from the platform (above). */
export const SITE = {
  /** One sentence: the meta description of pages that have none of their own. Use `{name}`. */
  description: 'The Plaza Auto Mall Accountability Hub: every customer case, one owner, every touch on record.',
  /** `en`, `fr`, … : the page language (screen readers, search engines). */
  lang: 'en',
  /**
   * The address search engines should treat as THE address (canonical URLs,
   * sitemap, social cards): set it to the custom domain once the owner has one
   * (`https://www.example.com`, no trailing slash). Empty = the address
   * The platform gives the site (`SITE_URL`, src/lib/seo.ts).
   */
  url: '',
};

export interface NavItem {
  label: string;
  href: string;
  /**
   * `false` for a page rendered on every visit (SSR, like `/jobs/`): it is
   * private (`no-store`), so fetching it ahead would be wasted. Every other
   * item is prerendered and prefetched as soon as the nav is on screen.
   */
  prefetch?: false;
}

/**
 * Top navigation. Every href is a page of THIS site (`/`, `/blog/`, `/jobs/`,
 * `/about/`, `/portal`, `/account/…`): plain links.
 */
export const NAV: NavItem[] = [{label: 'Home', href: '/'}];

/** The home page: the way into the hub. */
export const HOME = {
  eyebrow: 'Plaza Auto Mall',
  title: 'Accountability Hub',
  body: 'Every Hot Prospect and CSI case in one place: one named owner at all times, every touch time-stamped, and how it ended.',
  help: 'No account yet? Ask your admin to add you. You sign in with a code sent to your work email.',
};

export const ABOUT = {
  title: 'About {name}',
  lede: 'Who we are, and why we do this.',
  sections: [
    {
      heading: 'Our story',
      body: '{name} started with a simple idea: good things are easier together. Replace this text with your own story.',
    },
    {
      heading: 'What you will find here',
      body: 'A blog with practical guides, open roles, and a dashboard for everyone with an account.',
    },
    {
      heading: 'How to take part',
      body: 'Create an account and open your dashboard. Everyone is welcome.',
    },
  ],
};

/** Fill `{name}` with the site's name. */
export function withName(text: string, name: string): string {
  return text.replaceAll('{name}', name);
}
