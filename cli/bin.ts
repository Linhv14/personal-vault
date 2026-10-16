import { main } from "./main.js";

main(process.argv.slice(2), process.env).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`Trust1 Vault: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
