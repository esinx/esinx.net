import { defineConfig } from "astro/config"
import mdx from "@astrojs/mdx"

import sitemap from "@astrojs/sitemap"

// https://astro.build/config
export default defineConfig({
	site: "https://esinx.net",
	integrations: [
		mdx({
			drafts: true,
		}),
		sitemap(),
	],
	markdown: {
		shikiConfig: {
			theme: "dracula",
		},
		drafts: true,
	},
})
