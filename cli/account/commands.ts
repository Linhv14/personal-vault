import { spawn } from "node:child_process";
import { formatDotenv } from "../../src/core/projects.js";
import { DEFAULT_SERVER } from "../../src/core/brand.js";
import { remember, remembered } from "../agent/config.js";
import {
  AgentError,
  listOrgs,
  listProjects,
  loadEnvironment,
  noteAccess,
  selectEnvironment,
  signIn,
  signOut,
  type Selected,
  type Session,
} from "../agent/session.js";
import { ask, askHidden, choose } from "../agent/terminal.js";
import {
  loadLogin,
  loginOf,
  pausedBy,
  saveLogin,
  sessionOf,
  systemKeyring,
  type Keyring,
} from "./credentials.js";
import { findLink, LINK_FILE, writeLink } from "./link.js";

export interface Flags {
  email?: string;
  server?: string;
  org?: string;
  project?: string;
  environment?: string;
  command: string[];
}

export interface Context {
  env: NodeJS.ProcessEnv;
  cwd: string;
  keyring: Keyring;
  request: typeof fetch;
  log: (line: string) => void;
  out: (text: string) => void;
  ask: (question: string) => Promise<string>;
  askPassword: (question: string) => Promise<string>;
  choose: (title: string, options: string[]) => Promise<number>;
}

export function defaultContext(env: NodeJS.ProcessEnv): Context {
  return {
    env,
    cwd: process.cwd(),
    keyring: systemKeyring(env),
    request: fetch,
    log: (line) => console.error(line),
    out: (text) => process.stdout.write(text),
    ask,
    askPassword: askHidden,
    choose,
  };
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { command: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new AgentError(`${arg} needs a value`);
      return next;
    };
    if (arg === "--") {
      flags.command = argv.slice(index + 1);
      break;
    }
    if (arg === "--email") flags.email = value();
    else if (arg === "--server") flags.server = value();
    else if (arg === "--org") flags.org = value();
    else if (arg === "--project") flags.project = value();
    else if (arg === "--env") flags.environment = value();
    else throw new AgentError(`Unexpected argument: ${arg}`);
  }
  return flags;
}

const date = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

export function currentSession(context: Context): Session | null {
  const login = loadLogin(context.keyring);
  return login ? sessionOf(login, context.request) : null;
}

function requireSession(context: Context): Session {
  if (context.env.SEVENKEY_AGENT === "1") {
    throw new AgentError("7key does not hand out secrets inside 7key agent");
  }
  const session = currentSession(context);
  if (session) return session;
  const pid = pausedBy(context.env);
  if (pid) {
    throw new AgentError(
      `Your login is set aside while 7key agent (pid ${pid}) runs; it comes back when the agent exits`,
    );
  }
  throw new AgentError("Not logged in. Run: 7key login");
}

export async function login(flags: Flags, context: Context): Promise<number> {
  if (context.env.SEVENKEY_AGENT === "1") {
    throw new AgentError("7key login is not available inside 7key agent");
  }
  const saved = remembered(context.env);
  const server = flags.server ?? context.env.SEVENKEY_SERVER ?? saved.server ?? DEFAULT_SERVER;
  const email =
    (
      flags.email ??
      context.env.SEVENKEY_EMAIL ??
      (await context.ask(saved.email ? `Email [${saved.email}]: ` : "Email: ")) ??
      ""
    ).trim() || saved.email;
  if (!email) throw new AgentError("An email is needed");
  const password = await context.askPassword(`Master password for ${email}: `);
  const session = await signIn(server, email, password, context.request);
  const previous = currentSession(context);
  if (previous) await signOut(previous);
  const stored = loginOf(session, email);
  saveLogin(context.keyring, stored);
  remember(context.env, { email, server: session.server });
  context.log(`Logged in as ${email} on ${session.server}.`);
  context.log(`The session is kept in ${context.keyring.name} until ${date(stored.expiresAt)}.`);
  if (!findLink(context.cwd)) context.log("Next: 7key link, in your project's folder");
  return 0;
}

export async function logout(_flags: Flags, context: Context): Promise<number> {
  const session = currentSession(context);
  if (session) await signOut(session);
  context.keyring.remove();
  context.log(session ? "Logged out." : "Not logged in.");
  return 0;
}

export async function whoami(_flags: Flags, context: Context): Promise<number> {
  const stored = loadLogin(context.keyring);
  if (!stored) {
    context.log("Not logged in. Run: 7key login");
    return 1;
  }
  context.out(`${stored.email} on ${stored.server} (until ${date(stored.expiresAt)})\n`);
  const linked = findLink(context.cwd);
  context.out(
    linked
      ? `Linked: ${linked.link.org} / ${linked.link.project} / ${linked.link.environment} (${linked.file})\n`
      : "This folder is not linked. Run: 7key link\n",
  );
  return 0;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function pick<T>(
  title: string,
  items: T[],
  label: (item: T) => string,
  wanted: string | undefined,
  name: (item: T) => string,
  context: Context,
): Promise<T> {
  if (items.length === 0) throw new AgentError(`No ${title.toLowerCase()} to choose from`);
  if (wanted) {
    const found = items.filter((item) => same(name(item), wanted));
    if (found.length === 1) return found[0]!;
    if (found.length === 0) {
      throw new AgentError(`No ${title.toLowerCase()} "${wanted}" (${items.map(name).join(", ")})`);
    }
    items = found;
  }
  if (items.length === 1) {
    context.log(`${title}: ${label(items[0]!)}`);
    return items[0]!;
  }
  return items[await context.choose(title, items.map(label))]!;
}

export async function link(flags: Flags, context: Context): Promise<number> {
  const session = requireSession(context);
  const org = await pick(
    "Organization",
    await listOrgs(session),
    (entry) => entry.name,
    flags.org,
    (entry) => entry.name,
    context,
  );
  const project = await pick(
    "Project",
    await listProjects(session, org),
    (entry) => `${entry.content.name} (${entry.teamName})`,
    flags.project,
    (entry) => entry.content.name,
    context,
  );
  const environment = await pick(
    "Environment",
    project.content.environments,
    (entry) => entry.name,
    flags.environment,
    (entry) => entry.name,
    context,
  );
  const file = writeLink(context.cwd, {
    server: session.server,
    org: org.name,
    project: project.content.name,
    environment: environment.name,
    orgId: org.id,
    teamId: project.teamId,
    projectId: project.projectId,
    environmentId: environment.id,
  });
  context.log(`Linked to ${org.name} / ${project.content.name} / ${environment.name} (${file}).`);
  context.log(`${LINK_FILE} holds no secrets and can be committed.`);
  context.log("Next: 7key run -- <command>, or 7key agent -- <command>");
  return 0;
}

export async function resolveSelection(
  flags: Flags,
  context: Context,
  session: Session,
): Promise<Selected> {
  if (flags.project) {
    const linked = findLink(context.cwd)?.link;
    const environment = flags.environment ?? linked?.environment;
    if (!environment) throw new AgentError("Pass --env with --project");
    return selectEnvironment(session, flags.project, environment, flags.org);
  }
  const linked = findLink(context.cwd);
  if (!linked) {
    throw new AgentError("This folder is not linked. Run 7key link, or pass --project and --env");
  }
  if (linked.link.server !== session.server) {
    throw new AgentError(
      `${linked.file} points at ${linked.link.server}, but you are logged in to ${session.server}`,
    );
  }
  return loadEnvironment(session, linked.link, flags.environment);
}

export async function runLocal(flags: Flags, context: Context): Promise<number> {
  const [program, ...args] = flags.command;
  if (!program) throw new AgentError("Nothing to run: add -- <command>");
  const session = requireSession(context);
  const selected = await resolveSelection(flags, context, session);
  context.log(
    `7key: ${selected.secrets.length} values from ${selected.projectName} / ${selected.environment.name}`,
  );
  void noteAccess(session, selected, "exported");
  const childEnv: NodeJS.ProcessEnv = { ...context.env };
  for (const name of Object.keys(childEnv)) if (name.startsWith("SEVENKEY_")) delete childEnv[name];
  for (const { name, value } of selected.secrets) childEnv[name] = value;
  return new Promise((resolve) => {
    const child = spawn(program, args, { stdio: "inherit", env: childEnv });
    child.on("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    child.on("error", (error) => {
      context.log(`7key: ${error.message}`);
      resolve(127);
    });
  });
}

export async function dotenvLocal(flags: Flags, context: Context): Promise<number> {
  const session = requireSession(context);
  const selected = await resolveSelection(flags, context, session);
  await noteAccess(session, selected, "exported");
  context.out(formatDotenv(selected.secrets));
  return 0;
}

export async function listSecrets(flags: Flags, context: Context): Promise<number> {
  const session = requireSession(context);
  const selected = await resolveSelection(flags, context, session);
  context.out(`${selected.projectName} / ${selected.environment.name}\n`);
  for (const secret of selected.secrets) {
    const kind = secret.kind === "variable" ? "variable" : "secret";
    const hosts = secret.hosts?.length ? `  agent: ${secret.hosts.join(", ")}` : "";
    context.out(`  ${secret.name}  (${kind})${hosts}\n`);
  }
  return 0;
}
