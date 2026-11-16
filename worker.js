/**
 * Route the retired Contentful post URL to the current blog index.
 *
 * Workers Static Assets _redirects files do not match query strings, so this
 * exact legacy URL is handled here. All other requests are served unchanged
 * from the static asset binding.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === "/post.html" &&
      url.searchParams.get("id") === "55bf63glfw3loksBmWcOps"
    ) {
      return Response.redirect("https://bikasb.com.np/blog.html", 301);
    }

    return env.ASSETS.fetch(request);
  },
};
