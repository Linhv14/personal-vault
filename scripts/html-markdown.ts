const SKIP = new Set(["script", "style", "svg", "video", "template", "noscript", "button", "form"]);
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr", "col", "area"]);
const BLOCK = new Set([
  "p",
  "div",
  "section",
  "header",
  "footer",
  "main",
  "article",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "details",
  "summary",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "dl",
  "dt",
  "dd",
  "figure",
  "nav",
  "caption",
]);
const INLINE = new Set(["span", "a", "label", "strong", "b", "small", "em", "i", "code"]);
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
  rarr: "→",
  larr: "←",
  times: "×",
  copy: "©",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X"))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? decode(match[2] ?? match[3] ?? "") : null;
}

interface Frame {
  name: string;
  skip: boolean;
  href?: string | null;
  start: number;
}

export function htmlToMarkdown(html: string, base = ""): string {
  const body = html.match(/<main[^>]*>([\s\S]*)<\/main>/i)?.[1] ?? html;
  const tokens = body.replace(/<!--[\s\S]*?-->/g, "").split(/(<[^>]+>)/);
  const stack: Frame[] = [];
  const lists: { ordered: boolean; count: number }[] = [];
  let out = "";
  let row: string[] | null = null;
  let cell = "";
  let headerDone = false;
  let gap = "";
  let adjacent = false;
  const skipping = () => stack.some((frame) => frame.skip);
  const inPre = () => stack.some((frame) => frame.name === "pre");
  const write = (text: string) => {
    const before = row ? cell : out;
    if (gap && /\S$/.test(before) && /^[\p{L}\p{N}`*[(]/u.test(text)) text = gap + text;
    gap = "";
    if (row) cell += text;
    else out += text;
  };
  const block = () => {
    if (!row) out = out.replace(/[ \t]+$/, "") + "\n\n";
  };

  for (const token of tokens) {
    if (!token) continue;
    if (!token.startsWith("<")) {
      if (skipping()) continue;
      if (inPre()) {
        out += decode(token);
        continue;
      }
      const text = decode(token).replace(/\s+/g, " ");
      if (adjacent) gap = "";
      adjacent = false;
      if (text.trim() || /\S$/.test(row ? cell : out)) write(text);
      continue;
    }
    const closing = token.startsWith("</");
    const name = token.match(/^<\/?\s*([a-z0-9-]+)/i)?.[1]?.toLowerCase() ?? "";
    if (!name) continue;
    if (closing) {
      const index = stack.map((frame) => frame.name).lastIndexOf(name);
      if (index < 0) continue;
      const frame = stack[index]!;
      stack.length = index;
      if (frame.skip || skipping()) continue;
      if (inPre() && name !== "pre") continue;
      if (name === "pre") {
        out = out.replace(/\s+$/, "") + "\n```\n\n";
        continue;
      }
      if (name === "a" && frame.href) {
        const text = out.slice(frame.start).trim();
        out = out.slice(0, frame.start) + (text ? `[${text}](${frame.href})` : "");
      } else if (name === "strong" || name === "b") write("**");
      else if (name === "code") write("`");
      else if (name === "td" || name === "th") {
        row?.push(cell.trim().replace(/\|/g, "\\|"));
        cell = "";
      } else if (name === "tr" && row) {
        const cells = row;
        row = null;
        if (cells.some(Boolean)) {
          out += `| ${cells.join(" | ")} |\n`;
          if (!headerDone) {
            out += `| ${cells.map(() => "---").join(" | ")} |\n`;
            headerDone = true;
          }
        }
      } else if (name === "table") {
        headerDone = false;
        out += "\n";
      } else if (name === "ul" || name === "ol") {
        lists.pop();
        block();
      } else if (name === "li") out = out.replace(/[ \t]+$/, "") + "\n";
      else if (BLOCK.has(name)) block();
      if (INLINE.has(name)) {
        gap = name === "strong" || name === "b" ? " — " : " · ";
        adjacent = true;
      }
      continue;
    }
    adjacent = false;
    const selfClosing = token.endsWith("/>") || VOID.has(name);
    const hidden =
      SKIP.has(name) ||
      /\saria-hidden\s*=\s*"true"/i.test(token) ||
      /\shidden(\s|>|=)/i.test(token);
    if (name === "br" && !skipping()) {
      write("  \n");
      continue;
    }
    if (selfClosing) continue;
    const frame: Frame = { name, skip: hidden, start: out.length };
    stack.push(frame);
    if (hidden || skipping()) continue;
    if (inPre() && name !== "pre") continue;
    if (name === "pre") {
      block();
      out += "```\n";
      continue;
    }
    const heading = name.match(/^h([1-6])$/);
    if (heading) {
      block();
      write(`${"#".repeat(Number(heading[1]))} `);
    } else if (name === "summary") {
      block();
      write("### ");
    } else if (name === "a") {
      const href = attribute(token, "href");
      frame.href = !href || href.startsWith("#") ? null : base ? new URL(href, base).href : href;
      frame.start = out.length;
    } else if (name === "strong" || name === "b") write("**");
    else if (name === "code") write("`");
    else if (name === "ul" || name === "ol") {
      block();
      lists.push({ ordered: name === "ol", count: 0 });
    } else if (name === "li") {
      const list = lists.at(-1);
      if (list) list.count++;
      out = out.replace(/[ \t]+$/, "");
      if (!out.endsWith("\n")) out += "\n";
      out += `${"  ".repeat(Math.max(0, lists.length - 1))}${list?.ordered ? `${list.count}.` : "-"} `;
    } else if (name === "tr") {
      row = [];
      cell = "";
    } else if (name === "table") block();
    else if (BLOCK.has(name)) block();
  }

  return (
    out
      .split(/(```[\s\S]*?```)/)
      .map((part) =>
        part.startsWith("```")
          ? part
          : part
              .replace(/\*\*\s*\*\*/g, "")
              .replace(/[ \t]+\n/g, "\n")
              .replace(/\n[ \t]+(?=[^\s-\d|])/g, "\n")
              .replace(/\n{3,}/g, "\n\n"),
      )
      .join("")
      .trim() + "\n"
  );
}

export function pageMarkdown(html: string, base: string): string {
  const title = decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "").trim();
  const description = decode(
    html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? "",
  ).trim();
  const head = [title && `# ${title}`, description].filter(Boolean).join("\n\n");
  return `${head}\n\n${htmlToMarkdown(html, base)}`;
}
