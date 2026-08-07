export default {
  // PAGES=1 builds for GitHub Pages project hosting (assets under /longroad/).
  // An env flag rather than --base on the CLI: Git Bash on Windows rewrites any
  // argument that starts with a slash into a C:/Program Files/... path.
  base: process.env.PAGES ? '/longroad/' : '/',
  server: { port: 5190 },
  build: { target: 'es2022' },
};
