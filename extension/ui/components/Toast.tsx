export function Toast({ message }: { message: string | null }) {
  return (
    <div id="toast" role="status" hidden={!message}>
      {message}
    </div>
  );
}
