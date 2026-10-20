import { gsap } from "gsap";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.documentElement.classList.add("js");
pickSystem();
enableCopy();
loadVideos();
registerAgentTools();

if (!reduced) {
  revealSections();
  animateAudienceTabs();
  animateCounters();
  typeTerminal();
  travelPacket();
  followCursor();
  tickCodes();
}

function belowFold(element: Element): boolean {
  return element.getBoundingClientRect().top > window.innerHeight * 0.92;
}

function onView(
  elements: Element[],
  callback: (entered: Element[]) => void,
  rootMargin = "0px 0px -8% 0px",
): void {
  if (elements.length === 0) return;
  const observer = new IntersectionObserver(
    (entries) => {
      const entered = entries.filter((entry) => entry.isIntersecting).map((entry) => entry.target);
      for (const element of entered) observer.unobserve(element);
      if (entered.length > 0) callback(entered);
    },
    { rootMargin },
  );
  for (const element of elements) observer.observe(element);
}

function revealSections(): void {
  const targets = gsap.utils
    .toArray<HTMLElement>(
      [
        "main section .kicker",
        "main section h2",
        "main section .lede",
        ".seg",
        ".aud .panel > *",
        ".flow > .node",
        ".facts",
        ".dev > .term",
        ".side > *",
        ".bento > .tile",
        ".tbl",
        ".note",
        ".plans > .plan",
        ".install li",
        "#faq details",
        ".final h2",
        ".final p",
        ".final .ctas",
      ].join(","),
    )
    .filter(belowFold);
  gsap.set(targets, { opacity: 0, y: 28 });
  onView(targets, (batch) =>
    gsap.to(batch, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.08 }),
  );
  const chips = gsap.utils.toArray<HTMLElement>(".bento .chip, .bento .mini").filter(belowFold);
  gsap.set(chips, { opacity: 0, scale: 0.85 });
  onView(chips, (batch) =>
    gsap.to(batch, {
      opacity: 1,
      scale: 1,
      duration: 0.5,
      delay: 0.35,
      ease: "back.out(2)",
      stagger: 0.05,
    }),
  );
}

function animateAudienceTabs(): void {
  for (const panel of document.querySelectorAll<HTMLElement>(".aud .panel")) {
    panel.style.animation = "none";
  }
  for (const input of document.querySelectorAll<HTMLInputElement>(".aud > input")) {
    input.addEventListener("change", () => {
      const panel = document.getElementById(input.getAttribute("aria-controls") ?? "");
      if (!panel) return;
      gsap.fromTo(
        panel.querySelectorAll(".mock, .benefits li"),
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.05, overwrite: true },
      );
      gsap.fromTo(
        panel.querySelectorAll(".float"),
        { opacity: 0, scale: 0.9 },
        { opacity: 1, scale: 1, duration: 0.45, delay: 0.2, ease: "back.out(2)", stagger: 0.1 },
      );
    });
  }
}

function tickCodes(): void {
  for (const demo of document.querySelectorAll<HTMLElement>(".codes-demo")) {
    const cells = [...demo.querySelectorAll<HTMLElement>(".cd")];
    const left = demo.querySelector<HTMLElement>("[data-codes-left]");
    const bar = demo.querySelector<HTMLElement>("[data-codes-bar]");
    const total = cells.length;
    let used = 0;
    const step = () => {
      if (used === 3) {
        used = 0;
        for (const cell of cells) cell.classList.remove("used");
      } else {
        cells[used]?.classList.add("used");
        used++;
      }
      if (left) left.textContent = String(total - used);
      if (bar) bar.style.width = `${((total - used) / total) * 100}%`;
    };
    onView([demo], () => {
      setTimeout(step, 700);
      setInterval(step, 1500);
    });
  }
}

function loadVideos(): void {
  const videos = [...document.querySelectorAll<HTMLVideoElement>("video[data-lazy-video]")];
  if (videos.length === 0) return;
  const start = (video: HTMLVideoElement) => {
    for (const source of video.querySelectorAll<HTMLSourceElement>("source[data-src]")) {
      source.src = source.dataset.src ?? "";
      source.removeAttribute("data-src");
    }
    video.load();
    void video.play().catch(() => {});
  };
  if (reduced || window.matchMedia("(max-width: 900px)").matches) {
    document.documentElement.classList.add("video-manual");
    for (const video of videos) {
      const frame = video.parentElement;
      frame?.querySelector("[data-video-play]")?.addEventListener("click", () => {
        frame.classList.add("playing");
        start(video);
      });
    }
    return;
  }
  const watch = () => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        start(entry.target as HTMLVideoElement);
      }
    });
    for (const video of videos) observer.observe(video);
  };
  if (document.readyState === "complete") watch();
  else window.addEventListener("load", watch, { once: true });
}

interface ModelContext {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: object;
      annotations?: { readOnlyHint?: boolean };
      execute: (input: Record<string, unknown>) => Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ): Promise<void> | void;
}

const SECTIONS = [
  "product",
  "security",
  "developers",
  "teams",
  "compare",
  "pricing",
  "install",
  "faq",
];

function text(element: Element | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function registerAgentTools(): void {
  const context =
    (document as unknown as { modelContext?: ModelContext }).modelContext ??
    (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  if (!context) return;
  const controller = new AbortController();
  const lang = document.documentElement.lang.startsWith("vi") ? "vi" : "en";
  const tools: Parameters<ModelContext["registerTool"]>[0][] = [
    {
      name: "get_7key_overview",
      title: "Read the 7key page",
      description:
        "Return this page as Markdown: what 7key is, its features for individuals, teams and developers, security model, pricing and FAQ.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const response = await fetch(lang === "vi" ? "/vi" : "/", {
          headers: { Accept: "text/markdown" },
        });
        return response.text();
      },
    },
    {
      name: "get_pricing",
      title: "Get 7key pricing",
      description: "List the 7key plans with their price and what each includes.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () =>
        [...document.querySelectorAll("#pricing .plan")].map((plan) => ({
          name: text(plan.querySelector("h3")),
          details: text(plan),
        })),
    },
    {
      name: "get_install_steps",
      title: "How to install 7key",
      description: "Return the steps to install the 7key browser extension and the 7key CLI.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () =>
        [...document.querySelectorAll("#install .start-card")].map((card) => ({
          name: text(card.querySelector("h3")),
          steps: [...card.querySelectorAll("li, code")].map(text).filter(Boolean),
        })),
    },
    {
      name: "search_faq",
      title: "Search the 7key FAQ",
      description: "Find answers in the 7key FAQ that match a question or keywords.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Question or keywords" } },
        required: ["query"],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const words = String(input.query ?? "")
          .toLowerCase()
          .split(/\W+/u)
          .filter((word) => word.length > 2);
        return [...document.querySelectorAll("#faq details")]
          .map((item) => ({
            question: text(item.querySelector("summary")),
            answer: text(item.querySelector("p, div")),
          }))
          .filter((entry) => {
            const haystack = `${entry.question} ${entry.answer}`.toLowerCase();
            return words.length === 0 || words.some((word) => haystack.includes(word));
          });
      },
    },
    {
      name: "open_section",
      title: "Scroll to a section",
      description: "Scroll the page to one of its sections so the user can see it.",
      inputSchema: {
        type: "object",
        properties: { section: { type: "string", enum: SECTIONS } },
        required: ["section"],
      },
      execute: async (input) => {
        const target = document.getElementById(String(input.section));
        if (!target) return { ok: false };
        target.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
        return { ok: true };
      },
    },
  ];
  for (const tool of tools) {
    void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {});
  }
  window.addEventListener("pagehide", () => controller.abort(), { once: true });
}

function animateCounters(): void {
  const format = new Intl.NumberFormat(document.documentElement.lang || "en");
  const counters = [...document.querySelectorAll<HTMLElement>("[data-count]")].filter(
    (element) => Number.isFinite(Number(element.dataset.count)) && belowFold(element),
  );
  for (const element of counters) element.textContent = format.format(0);
  onView(counters, (entered) => {
    for (const element of entered as HTMLElement[]) {
      const target = Number(element.dataset.count);
      const value = { n: 0 };
      gsap.to(value, {
        n: target,
        duration: target > 100 ? 1.6 : 0.9,
        delay: 0.3,
        ease: "power2.out",
        onUpdate: () => {
          element.textContent = format.format(Math.round(value.n));
        },
      });
    }
  });
}

function typeTerminal(): void {
  const code = document.querySelector<HTMLElement>(".term pre code");
  if (!code || !belowFold(code)) return;
  code.innerHTML = code.innerHTML
    .split("\n")
    .map((line) => `<span class="ln">${line}</span>`)
    .join("\n");
  const lines = gsap.utils.toArray<HTMLElement>(".term .ln");
  gsap.set(lines, { opacity: 0 });
  const timeline = gsap.timeline({ paused: true, delay: 0.3 });
  for (const line of lines) {
    const command = line.firstElementChild?.classList.contains("t-p") ?? false;
    const length = Math.max(1, (line.textContent ?? "").length);
    if (command && length > 2) {
      timeline.fromTo(
        line,
        { opacity: 1, clipPath: "inset(0 100% 0 0)" },
        { clipPath: "inset(0 0% 0 0)", duration: length * 0.018, ease: `steps(${length})` },
        "+=0.15",
      );
    } else {
      timeline.to(line, { opacity: 1, duration: 0.3, ease: "power1.out" }, "+=0.08");
    }
  }
  onView([code], () => timeline.play(), "0px 0px -20% 0px");
}

function travelPacket(): void {
  const flow = document.querySelector<HTMLElement>(".flow");
  const wires = flow?.querySelectorAll<HTMLElement>(".wire");
  const nodes = flow?.querySelectorAll<HTMLElement>(".node");
  if (!flow || wires?.length !== 2 || nodes?.length !== 3) return;
  const [first, second] = [wires[0]!, wires[1]!];
  flow.classList.add("js-packet");
  const packet = document.createElement("span");
  packet.className = "packet";
  packet.setAttribute("aria-hidden", "true");
  flow.append(packet);

  const point = (wire: HTMLElement, start: boolean) => {
    const box = wire.getBoundingClientRect();
    const origin = flow.getBoundingClientRect();
    const across = box.width >= box.height;
    const x = across ? (start ? box.left : box.right) : box.left + box.width / 2;
    const y = across ? box.top + box.height / 2 : start ? box.top : box.bottom;
    return { x: x - origin.left, y: y - origin.top };
  };

  const glow = (node: HTMLElement | undefined) =>
    gsap.fromTo(
      node?.querySelector(".ic") ?? [],
      { scale: 1, boxShadow: "0 0 0 0 rgba(255,106,61,0.6)" },
      {
        scale: 1.12,
        boxShadow: "0 0 0 10px rgba(255,106,61,0)",
        duration: 0.4,
        yoyo: true,
        repeat: 1,
      },
    );

  const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.8, paused: true });
  timeline
    .add(glow(nodes[0]))
    .fromTo(
      packet,
      { x: () => point(first, true).x, y: () => point(first, true).y, autoAlpha: 0 },
      {
        x: () => point(first, false).x,
        y: () => point(first, false).y,
        autoAlpha: 1,
        duration: 0.9,
        ease: "power2.inOut",
      },
    )
    .to(packet, { autoAlpha: 0, duration: 0.15 })
    .add(glow(nodes[1]))
    .set(packet, { x: () => point(second, true).x, y: () => point(second, true).y })
    .to(packet, { autoAlpha: 1, duration: 0.15 })
    .to(packet, {
      x: () => point(second, false).x,
      y: () => point(second, false).y,
      duration: 0.9,
      ease: "power2.inOut",
    })
    .to(packet, { autoAlpha: 0, duration: 0.15 })
    .add(glow(nodes[2]));

  new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) timeline.play();
    else timeline.pause();
  }).observe(flow);
  let resize = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resize);
    resize = window.setTimeout(() => timeline.invalidate(), 150);
  });
}

function followCursor(): void {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  for (const card of gsap.utils.toArray<HTMLElement>(".card")) {
    const glow = { x: 0, y: 0 };
    const paint = () => {
      card.style.setProperty("--glow-x", `${glow.x}px`);
      card.style.setProperty("--glow-y", `${glow.y}px`);
    };
    const moveX = gsap.quickTo(glow, "x", { duration: 0.45, ease: "power3.out", onUpdate: paint });
    const moveY = gsap.quickTo(glow, "y", { duration: 0.45, ease: "power3.out", onUpdate: paint });
    const local = (event: PointerEvent) => {
      const box = card.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    card.addEventListener("pointerenter", (event) => {
      Object.assign(glow, local(event));
      paint();
      card.classList.add("glowing");
    });
    card.addEventListener("pointermove", (event) => {
      const point = local(event);
      moveX(point.x);
      moveY(point.y);
    });
    card.addEventListener("pointerleave", () => card.classList.remove("glowing"));
  }
}

function pickSystem(): void {
  const platform = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
  const id = platform.includes("win")
    ? "os-win"
    : platform.includes("linux") && !platform.includes("android")
      ? "os-linux"
      : "os-mac";
  const input = document.getElementById(id);
  if (input instanceof HTMLInputElement) input.checked = true;
}

function enableCopy(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".copy[data-copy]")) {
    button.addEventListener("click", () => {
      void navigator.clipboard.writeText(button.dataset.copy ?? "").then(() => {
        button.classList.add("done");
        window.setTimeout(() => button.classList.remove("done"), 1200);
      });
    });
  }
}
