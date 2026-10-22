const SVG_NS = "http://www.w3.org/2000/svg";

const FLAGS: Record<string, string> = {
  US: '<rect width="24" height="16" fill="#b22234"/><path d="M0 1.85h24M0 4.31h24M0 6.77h24M0 9.23h24M0 11.69h24M0 14.15h24" stroke="#fff" stroke-width="1.23"/><rect width="9.6" height="8.62" fill="#3c3b6e"/>',
  VN: '<rect width="24" height="16" fill="#da251d"/><path fill="#ffde00" d="M12 3.7L13.09 6.8L16.37 6.88L13.76 8.87L14.7 12.02L12 10.15L9.3 12.02L10.24 8.87L7.63 6.88L10.91 6.8Z"/>',
};

const MASTERCARD =
  '<circle cx="9" cy="8" r="5" fill="#eb001b"/><circle cx="15" cy="8" r="5" fill="#f79e1b" fill-opacity="0.9"/>';

export const BRAND_LABEL: Record<string, string> = {
  visa: "VISA",
  amex: "AMEX",
  discover: "DISC",
  jcb: "JCB",
  unionpay: "UP",
  diners: "DC",
};

export function flagMarkup(code: string | undefined): string | null {
  return (code && FLAGS[code]) || null;
}

export function brandMarkup(brand: string): string | null {
  return brand === "mastercard" ? MASTERCARD : null;
}

function svgOf(markup: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 16");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = markup;
  return svg;
}

export function flagMark(code: string | undefined): HTMLElement {
  const node = document.createElement("span");
  node.className = "flag";
  const markup = flagMarkup(code);
  if (markup) {
    node.append(svgOf(markup));
  } else {
    node.textContent = code ?? "";
  }
  return node;
}

export function brandMark(brand: string): HTMLElement {
  const node = document.createElement("span");
  node.className = `brand brand-${brand}`;
  const markup = brandMarkup(brand);
  if (markup) {
    node.append(svgOf(markup));
  } else {
    node.textContent = BRAND_LABEL[brand] ?? "";
  }
  return node;
}
