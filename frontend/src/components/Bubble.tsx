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
          ? "bg-indigo-600 border-indigo-600 text-white shadow-sm"
          : "bg-white border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-700"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={active ? "text-indigo-200 ml-1" : "text-slate-400 ml-1"}>
          {count}
        </span>
      )}
    </button>
  );
}
