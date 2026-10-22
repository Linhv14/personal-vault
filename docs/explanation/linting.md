# Linting boundaries

The application keeps direct console calls in `src/worker/log.ts` and
`extension/lib/log.ts`. These modules preserve structured Worker observability
and extension warning output while the rest of the application uses the shared
logging entry points. Command-line and maintenance scripts write their normal
user output to the console.
