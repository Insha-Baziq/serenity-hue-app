export default function OperationsLoading() {
  return (
    <div className="operations-loading" aria-busy="true" aria-label="Loading workspace">
      <div className="operations-loading__heading">
        <span className="operations-loading__line operations-loading__line--short" />
        <span className="operations-loading__line operations-loading__line--title" />
        <span className="operations-loading__line operations-loading__line--body" />
      </div>
      <div className="operations-loading__toolbar">
        <span />
        <span />
      </div>
      <div className="operations-loading__table">
        {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
      </div>
    </div>
  );
}
