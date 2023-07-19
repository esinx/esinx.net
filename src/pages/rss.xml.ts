import rss from "@astrojs/rss"
import { getCollection } from "astro:content"
import { SITE_TITLE, SITE_DESCRIPTION } from "../consts"
import type { APIRoute } from "astro"

export const get: APIRoute = async (context) => {
	const rawPosts = await getCollection("blog")
	const posts = rawPosts.filter((post) => !post.data.draft)
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site?.toString() ?? "esinx.net",
		items: posts.map((post) => ({
			...post.data,
			link: `/blog/${post.slug}/`,
		})),
	})
}
