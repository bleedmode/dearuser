import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Hybrid output: static pages stay static by default. Only the dynamic
// `/r/[token]` route opts into server rendering (prerender=false in the
// file itself) so we can look up the report JSON at request time — tokens
// are unknown at build time. The Vercel adapter gives us a serverless
// function for that one route + static HTML for everything else.
export default defineConfig({
  site: 'https://dearuser.ai',
  output: 'static',
  adapter: vercel({
    imageService: true,
  }),
});
