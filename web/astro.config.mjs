import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

// Hybrid output: static pages stay static by default. Only the dynamic
// `/r/[token]` route opts into server rendering (prerender=false in the
// file itself) so we can look up the report JSON at request time — tokens
// are unknown at build time. The Vercel adapter gives us a serverless
// function for that one route + static HTML for everything else.
export default defineConfig({
  site: 'https://dearuser.ai',
  output: 'static',
  integrations: [
    sitemap({
      // Skip dynamic /r/<token> share pages — tokens are unknown at build time
      // and each share URL is unique to its recipient, not general-audience content.
      filter: (page) => !page.includes('/r/'),
    }),
  ],
  adapter: vercel({
    imageService: true,
  }),
});
