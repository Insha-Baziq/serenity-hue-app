"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { LabIngredient } from "@/lib/types";

export function LabIngredientPicker({
  ingredients,
  value,
  onChange,
  label,
}: {
  ingredients: LabIngredient[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return ingredients.filter((ingredient) => ingredient.title.toLocaleLowerCase().includes(search));
  }, [ingredients, query]);

  function show() {
    setQuery("");
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function select(title: string) {
    onChange(title);
    setOpen(false);
    setQuery("");
  }

  return <div className="lab-ingredient-picker">
    <button type="button" className="lab-ingredient-picker__trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => open ? setOpen(false) : show()}>
      <span className={value ? "" : "is-placeholder"}>{value || "Select an ingredient"}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div className="lab-ingredient-picker__popover">
      <div className="lab-ingredient-picker__search"><Search size={15} aria-hidden="true" /><Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ingredients…" aria-label="Search ingredients" onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
        if (event.key === "Enter" && results[0]) { event.preventDefault(); select(results[0].title); }
      }} /></div>
      <div className="lab-ingredient-picker__options" role="listbox" aria-label="Ingredients">
        {results.map((ingredient) => <button type="button" role="option" aria-selected={value === ingredient.title} className="lab-ingredient-picker__option" key={ingredient.id} onClick={() => select(ingredient.title)}>
          <span>{ingredient.title}</span>{value === ingredient.title && <Check size={15} aria-hidden="true" />}
        </button>)}
        {!results.length && <p className="lab-ingredient-picker__empty">No matches. Add it from Ingredient inventory.</p>}
      </div>
    </div>}
  </div>;
}
