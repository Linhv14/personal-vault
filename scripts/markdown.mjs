const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escape(text) {
  return text.replace(/[&<>"]/g, (char) => ESCAPES[char]);
}

function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
      /^https?:\/\//.test(href) ? `<a href="${href}">${label}</a>` : label,
    );
}

function cells(row) {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;
  const isBlockStart = (line) => /^(#{1,6} |```|\||- |\d+\. )/.test(line) || line.trim() === "";

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
    } else if (line.startsWith("```")) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      index += 1;
      html.push(`<pre><code>${escape(code.join("\n"))}</code></pre>`);
    } else if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      html.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`);
      index += 1;
    } else if (line.startsWith("|")) {
      const rows = [];
      while (index < lines.length && lines[index].startsWith("|")) rows.push(lines[index++]);
      const [header, , ...body] = rows;
      html.push(
        '<div class="table"><table><thead><tr>' +
          cells(header)
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
      const items = [];
      while (index < lines.length && /^(- |\d+\. )/.test(lines[index])) {
        const parts = [lines[index].replace(/^(- |\d+\. )/, "")];
        index += 1;
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]))
          parts.push(lines[index++].trim());
        items.push(`<li>${inline(parts.join(" "))}</li>`);
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.join("")}</${tag}>`);
    } else {
      const parts = [];
      while (index < lines.length && !isBlockStart(lines[index])) parts.push(lines[index++].trim());
      html.push(`<p>${inline(parts.join(" "))}</p>`);
    }
  }
  return html.join("\n");
}
