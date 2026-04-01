import {
  useBoardStore,
  BOARD_COLUMNS,
} from "@/stores/board-store";
import { useI18n } from "@/hooks/use-i18n";

export function ColumnToggle() {
  const { t } = useI18n();
  const { hiddenColumns, toggleColumn } = useBoardStore();
  const columnLabel = (column: (typeof BOARD_COLUMNS)[number]): string => {
    if (column === "backlog") return t("board.column.backlog");
    if (column === "analysis") return t("board.column.analysis");
    if (column === "in_progress") return t("board.column.inProgress");
    if (column === "testing") return t("board.column.testing");
    return t("board.column.finished");
  };

  return (
    <div className="inline-flex items-center gap-0 rounded-md bg-surface-container-high overflow-hidden">
      <span className="text-[0.6875rem] font-medium text-on-surface/50 uppercase tracking-wider px-3">
        {t("board.columns")}
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
            title={
              isVisible
                ? `${t("board.column.hide")} ${columnLabel(column)}`
                : `${t("board.column.show")} ${columnLabel(column)}`
            }
          >
            {columnLabel(column)}
          </button>
        );
      })}
    </div>
  );
}
