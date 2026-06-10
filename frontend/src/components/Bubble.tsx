interface BubbleProps {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}

export default function Bubble({ label, active, onClick, count }: BubbleProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
        active
          ? "bg-amber-500 border-amber-500 text-black shadow-sm"
          : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-amber-500 hover:text-amber-400"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={active ? "text-black/60 ml-1" : "text-zinc-500 ml-1"}>
          {count}
        </span>
      )}
    </button>
  );
}
