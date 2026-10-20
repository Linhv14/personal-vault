import type { Page } from "@playwright/test";

interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue: string;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: (DomNode & { shadowRootType?: string })[];
}

export interface ShadowElement {
  nodeId: number;
  text: string;
  hidden: boolean;
}

function attribute(node: DomNode, name: string): string | null {
  const attributes = node.attributes ?? [];
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) return attributes[index + 1] ?? "";
  }
  return null;
}

function textOf(node: DomNode): string {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeName === "STYLE") return "";
  return (node.children ?? []).map(textOf).join(" ");
}

function collect(node: DomNode, match: (node: DomNode) => boolean, found: DomNode[]): DomNode[] {
  if (match(node)) found.push(node);
  for (const child of node.children ?? []) collect(child, match, found);
  return found;
}

function closedRoots(node: DomNode, found: DomNode[] = []): DomNode[] {
  for (const root of node.shadowRoots ?? []) {
    if (root.shadowRootType === "closed") found.push(root);
  }
  for (const child of node.children ?? []) closedRoots(child, found);
  return found;
}

export class ClosedShadow {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private async withDocument<T>(
    use: (root: DomNode, send: (method: string, params: object) => Promise<unknown>) => Promise<T>,
  ): Promise<T> {
    const session = await this.page.context().newCDPSession(this.page);
    try {
      const { root } = (await session.send("DOM.getDocument", { depth: -1, pierce: true })) as {
        root: DomNode;
      };
      return await use(root, (method, params) =>
        session.send(method as "DOM.getBoxModel", params as { nodeId: number }),
      );
    } finally {
      await session.detach();
    }
  }

  async find(className: string): Promise<ShadowElement[]> {
    return this.withDocument(async (root) =>
      closedRoots(root)
        .flatMap((shadow) =>
          collect(
            shadow,
            (node) => (attribute(node, "class") ?? "").split(" ").includes(className),
            [],
          ),
        )
        .map((node) => ({
          nodeId: node.nodeId,
          text: textOf(node).replace(/\s+/g, " ").trim(),
          hidden: attribute(node, "hidden") !== null,
        })),
    );
  }

  async visibleText(className: string): Promise<string> {
    return (await this.find(className))
      .filter((element) => !element.hidden)
      .map((element) => element.text)
      .join(" ");
  }

  async click(className: string, text: string | RegExp): Promise<void> {
    const point = await this.withDocument(async (root, send) => {
      const target = closedRoots(root)
        .flatMap((shadow) => collect(shadow, (node) => node.nodeName === "BUTTON", []))
        .find((node) => {
          const classes = (attribute(node, "class") ?? "").split(" ");
          const label = textOf(node).replace(/\s+/g, " ").trim();
          return (
            classes.includes(className) &&
            (typeof text === "string" ? label === text : text.test(label))
          );
        });
      if (!target) throw new Error(`No ${className} element matching ${String(text)}`);
      const { model } = (await send("DOM.getBoxModel", { nodeId: target.nodeId })) as {
        model: { content: number[] };
      };
      const [x1 = 0, y1 = 0, , , x3 = 0, y3 = 0] = model.content;
      return { x: (x1 + x3) / 2, y: (y1 + y3) / 2 };
    });
    await this.page.mouse.click(point.x, point.y);
  }
}
