interface ClearFiltersButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function ClearFiltersButton({ visible, onClick }: ClearFiltersButtonProps) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 px-2 rounded-md text-xs font-medium
        text-muted-foreground hover:text-primary
        bg-transparent hover:bg-foreground/5
        transition-all duration-200"
    >
      Clear filters
    </button>
  );
}
