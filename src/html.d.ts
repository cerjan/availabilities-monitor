// Wrangler bundles `*.html` as text modules.
declare module '*.html' {
  const content: string;
  export default content;
}
