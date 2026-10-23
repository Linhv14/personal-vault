declare const __SEVENKEY_CLI_VERSION__: string | undefined;

export const CLI_VERSION =
  typeof __SEVENKEY_CLI_VERSION__ === "string" ? __SEVENKEY_CLI_VERSION__ : "dev";
