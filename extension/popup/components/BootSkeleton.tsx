const ROWS = 6;

export function BootSkeleton() {
  return (
    <div className="boot-skeleton" aria-busy="true">
      <div className="topbar">
        <span className="bone bone-pill" />
        <span className="bone bone-search" />
      </div>
      <div className="panes">
        <div className="list-pane">
          {Array.from({ length: ROWS }, (_, index) => (
            <div className="bone-row" key={index}>
              <span className="bone bone-avatar" />
              <span className="bone-lines">
                <span className="bone bone-title" />
                <span className="bone bone-sub" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
