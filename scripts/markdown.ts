const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

function inline(text: string): string {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_: string, label: string, href: string) =>
      /^https?:\/\//.test(href) ? `<a href="${href}">${label}</a>` : label,
    );
}

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function renderMarkdown(markdown: string): string {
  const source = markdown.replace(/\r\n/g, "\n").split("\n");
  const lines = { length: source.length, at: (n: number) => source[n] ?? "" };
  const html: string[] = [];
  let index = 0;
  const isBlockStart = (line: string) =>
    /^(#{1,6} |```|\||- |\d+\. )/.test(line) || line.trim() === "";

  while (index < lines.length) {
    const line = lines.at(index);
    if (line.trim() === "") {
      index += 1;
    } else if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines.at(index).startsWith("```"))
        code.push(lines.at(index++));
      index += 1;
      html.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
    } else if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)?.[0].length ?? 1;
      html.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`);
      index += 1;
    } else if (line.startsWith("|")) {
      const rows: string[] = [];
      while (index < lines.length && lines.at(index).startsWith("|")) rows.push(lines.at(index++));
      const [header, , ...body] = rows;
      html.push(
        '<div class="table"><table><thead><tr>' +
          cells(header ?? "")
            .map((cell) => `<th>${inline(cell)}</th>`)
            .join("") +
          "</tr></thead><tbody>" +
          body
            .map(
              (row) =>
                `<tr>${cells(row)
                  .map((cell) => `<td>${inline(cell)}</td>`)
                  .join("")}</tr>`,
            )
            .join("") +
          "</tbody></table></div>",
      );
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const items: string[] = [];
      while (index < lines.length && /^(- |\d+\. )/.test(lines.at(index))) {
        const parts = [lines.at(index).replace(/^(- |\d+\. )/, "")];
        index += 1;
        while (index < lines.length && /^\s{2,}\S/.test(lines.at(index)))
          parts.push(lines.at(index++).trim());
        items.push(`<li>${inline(parts.join(" "))}</li>`);
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.join("")}</${tag}>`);
    } else {
      const parts: string[] = [];
      while (index < lines.length && !isBlockStart(lines.at(index)))
        parts.push(lines.at(index++).trim());
      html.push(`<p>${inline(parts.join(" "))}</p>`);
    }
  }
  return html.join("\n");
}
