const BLOCK = /<!-- lang:(\w+) -->([\s\S]*?)<!-- \/lang -->\n?/g;

export function localizePage(html, lang) {
  const languages = new Set([...html.matchAll(BLOCK)].map((match) => match[1]));
  if (!languages.has(lang)) throw new Error(`The page has no blocks for "${lang}"`);
  return html
    .replace(BLOCK, (_, blockLang, content) => (blockLang === lang ? content : ""))
    .replace(/<html lang="[^"]*">/, `<html lang="${lang}">`);
}
