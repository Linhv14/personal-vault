export const HOME_LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"',
  '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</api-docs>; rel="service-doc"; type="text/html"',
  '</auth.md>; rel="describedby"; type="text/markdown"',
].join(", ");

export function apiCatalog(origin: string): unknown {
  return {
    linkset: [
      {
        anchor: `${origin}/api/`,
        "service-desc": [{ href: `${origin}/openapi.json`, type: "application/openapi+json" }],
        "service-doc": [{ href: `${origin}/api-docs`, type: "text/html" }],
        status: [{ href: `${origin}/api/health`, type: "application/json" }],
        describedby: [{ href: `${origin}/auth.md`, type: "text/markdown" }],
      },
    ],
  };
}
