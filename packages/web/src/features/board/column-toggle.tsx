import {
  useBoardStore,
  BOARD_COLUMNS,
  COLUMN_LABELS,
} from "@/stores/board-store";

export function ColumnToggle() {
  const { hiddenColumns, toggleColumn } = useBoardStore();

  return (
    <div className="inline-flex items-center gap-0 rounded-md bg-surface-container-high overflow-hidden">
      <span className="text-[0.6875rem] font-medium text-on-surface/50 uppercase tracking-wider px-3">
        Columns
      </span>
      {BOARD_COLUMNS.map((column) => {
        const isVisible = !hiddenColumns.has(column);
        return (
          <button
            key={column}
            type="button"
            onClick={() => toggleColumn(column)}
            className={`h-7 px-2.5 text-xs font-medium transition-all duration-200
              ${
                isVisible
                  ? "bg-primary text-primary-foreground"
                  : "text-on-surface/50 hover:text-on-surface hover:bg-on-surface/5"
              }`}
            title={isVisible ? `Hide ${COLUMN_LABELS[column]}` : `Show ${COLUMN_LABELS[column]}`}
          >
            {COLUMN_LABELS[column]}
          </button>
        );
      })}
    </div>
  );
}
