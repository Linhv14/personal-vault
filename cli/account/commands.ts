import { spawn } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatDotenv, handleOf, refersTo } from "../../src/core/projects.js";
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
  INSECURE_FILE_STORE_FLAG,
  systemKeyring,
  type Keyring,
} from "./credentials.js";
import { findLink, LINK_FILE, writeLink } from "./link.js";
import { injectTemplate, parseReference, type Scope } from "./reference.js";

export interface Flags {
  email?: string;
  server?: string;
  org?: string;
  project?: string;
  environment?: string;
  input?: string;
  output?: string;
  force?: boolean;
  insecureFileStore?: boolean;
  positional?: string[];
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
  isTTY?: boolean;
  readInput?: () => Promise<string>;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function defaultContext(
  env: NodeJS.ProcessEnv,
  options: { insecureFileStore?: boolean } = {},
): Context {
  return {
    env,
    cwd: process.cwd(),
    keyring: systemKeyring(env, options),
    request: fetch,
    log: (line) => console.error(line),
    out: (text) => process.stdout.write(text),
    ask,
    askPassword: askHidden,
    choose,
    isTTY: process.stdout.isTTY === true,
    readInput: readStdin,
  };
}

export function parseFlags(argv: string[], options: { positional?: boolean } = {}): Flags {
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
    else if (arg === "-i" || arg === "--in") flags.input = value();
    else if (arg === "-o" || arg === "--out") flags.output = value();
    else if (arg === "--force") flags.force = true;
    else if (arg === INSECURE_FILE_STORE_FLAG) flags.insecureFileStore = true;
    else if (options.positional && !arg.startsWith("-")) {
      flags.positional = [...(flags.positional ?? []), arg];
    } else throw new AgentError(`Unexpected argument: ${arg}`);
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
  if (context.keyring.unavailable) throw new AgentError(context.keyring.unavailable);
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
  if (context.keyring.warning) context.log(context.keyring.warning);
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

async function pick<T>(
  title: string,
  items: T[],
  label: (item: T) => string,
  wanted: string | undefined,
  name: (item: T) => { id: string; name: string },
  context: Context,
): Promise<T> {
  if (items.length === 0) throw new AgentError(`No ${title.toLowerCase()} to choose from`);
  if (wanted) {
    const found = items.filter((item) => refersTo(wanted, name(item)));
    if (found.length === 1) return found[0]!;
    if (found.length === 0) {
      throw new AgentError(
        `No ${title.toLowerCase()} "${wanted}" (${items.map((item) => handleOf(name(item).name)).join(", ")})`,
      );
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
    (entry) => `${entry.name}  [${handleOf(entry.name)}]`,
    flags.org,
    (entry) => entry,
    context,
  );
  const project = await pick(
    "Project",
    await listProjects(session, org),
    (entry) => `${entry.content.name} (${entry.teamName})  [${handleOf(entry.content.name)}]`,
    flags.project,
    (entry) => ({ id: entry.projectId, name: entry.content.name }),
    context,
  );
  const environment = await pick(
    "Environment",
    project.content.environments,
    (entry) => entry.name,
    flags.environment,
    (entry) => entry,
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
  context.log(
    `Elsewhere: --project ${handleOf(project.content.name)} --env ${handleOf(environment.name)} (project id ${project.projectId})`,
  );
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
  context.out(
    `${selected.projectName} / ${selected.environment.name}  (--project ${handleOf(selected.projectName)} or ${selected.projectId})\n`,
  );
  for (const secret of selected.secrets) {
    const kind = secret.kind === "variable" ? "variable" : "secret";
    const hosts = secret.hosts?.length ? `  agent: ${secret.hosts.join(", ")}` : "";
    context.out(`  ${secret.name}  (${kind})${hosts}\n`);
  }
  return 0;
}

async function selectScope(
  flags: Flags,
  context: Context,
  session: Session,
  scope: Scope,
): Promise<Selected> {
  return resolveSelection(
    scope.project ? { ...flags, project: scope.project, environment: scope.environment } : flags,
    context,
    session,
  );
}

export async function readSecret(flags: Flags, context: Context): Promise<number> {
  const [text, ...extra] = flags.positional ?? [];
  if (!text || extra.length) {
    throw new AgentError("Usage: 7key read <NAME | 7key://project/env/NAME>");
  }
  const reference = parseReference(text);
  const session = requireSession(context);
  const selected = await selectScope(flags, context, session, reference);
  const secret = selected.secrets.find((entry) => entry.name === reference.name);
  if (!secret) {
    throw new AgentError(
      `No secret "${reference.name}" in ${selected.projectName} / ${selected.environment.name}`,
    );
  }
  await noteAccess(session, selected, "revealed");
  context.out(context.isTTY ? `${secret.value}\n` : secret.value);
  return 0;
}

export async function inject(flags: Flags, context: Context): Promise<number> {
  const target = flags.output ? path.resolve(context.cwd, flags.output) : undefined;
  if (target && !flags.force && existsSync(target)) {
    throw new AgentError(`${flags.output} already exists; pass --force to overwrite it`);
  }
  const session = requireSession(context);
  const template = flags.input
    ? readFileSync(path.resolve(context.cwd, flags.input), "utf8")
    : await (context.readInput ?? readStdin)();
  const result = await injectTemplate(template, (scope) =>
    selectScope(flags, context, session, scope),
  );
  if (result.missing.length) {
    const plural = result.missing.length === 1 ? "reference" : "references";
    throw new AgentError(
      `${result.missing.length} ${plural} not found, nothing written:\n${result.missing.map((entry) => `  ${entry}`).join("\n")}`,
    );
  }
  await Promise.all(result.loaded.map((selected) => noteAccess(session, selected, "injected")));
  if (target) {
    try {
      writeFileSync(target, result.text, { mode: 0o600, flag: flags.force ? "w" : "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new AgentError(`${flags.output} already exists; pass --force to overwrite it`);
      }
      throw error;
    }
    chmodSync(target, 0o600);
  } else {
    context.out(result.text);
  }
  context.log(
    `7key: injected ${result.count} ${result.count === 1 ? "reference" : "references"}${target ? ` into ${flags.output}` : ""}`,
  );
  return 0;
}
