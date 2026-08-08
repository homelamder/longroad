// Base-aware asset URLs. The game deploys under /longroad/ on GitHub Pages, so a
// hardcoded '/tex/x.jpg' would resolve against the domain root and 404. Every
// runtime-loaded file (textures, GLBs, HDRIs) goes through here.
export const asset = (p) => (import.meta.env?.BASE_URL ?? '/') + p.replace(/^\//, '');
